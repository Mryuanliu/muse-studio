import { BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface NpmInstallResult {
  installDir: string;
  entrypoint: string;
  log: string;
}

@Injectable()
export class McpInstallerService {
  private readonly packagesRoot = path.resolve(__dirname, '../../../sandbox/mcp-packages');

  async installNpm(name: string, packageName: string, packageVersion: string): Promise<NpmInstallResult> {
    this.validatePackageName(packageName);
    this.validateVersion(packageVersion);
    const installDir = path.join(this.packagesRoot, name);
    this.assertInside(this.packagesRoot, installDir);
    fs.mkdirSync(this.packagesRoot, { recursive: true });
    fs.mkdirSync(installDir, { recursive: true });

    const spec = `${packageName}@${packageVersion}`;
    try {
      const result = await execFileAsync('npm', [
        'install',
        '--prefix', installDir,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=true',
        spec,
      ], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
      const packageRoot = this.resolvePackageRoot(installDir, packageName);
      const entrypoint = this.resolveEntrypoint(packageRoot, packageName);
      return { installDir, entrypoint, log: `${result.stdout || ''}${result.stderr || ''}`.slice(-20000) };
    } catch (error: any) {
      const output = `${error?.stdout || ''}${error?.stderr || ''}`.slice(-20000);
      throw new BadRequestException(`npm MCP 安装失败：${output || error?.message || 'unknown error'}`);
    }
  }

  packageSpecValid(packageName: string, packageVersion: string): boolean {
    try { this.validatePackageName(packageName); this.validateVersion(packageVersion); return true; } catch { return false; }
  }

  private resolvePackageRoot(installDir: string, packageName: string): string {
    const packageRoot = path.join(installDir, 'node_modules', packageName);
    if (!fs.existsSync(path.join(packageRoot, 'package.json'))) throw new BadRequestException('npm 包未生成有效的 package.json');
    return packageRoot;
  }

  private resolveEntrypoint(packageRoot: string, packageName: string): string {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const bin = typeof manifest.bin === 'string'
      ? manifest.bin
      : manifest.bin && typeof manifest.bin === 'object'
        ? manifest.bin[packageName] || Object.values(manifest.bin)[0]
        : undefined;
    const candidate = bin || manifest.main;
    if (typeof candidate !== 'string') throw new BadRequestException('npm 包没有可识别的 bin 或 main 入口');
    const entrypoint = path.resolve(packageRoot, candidate);
    this.assertInside(packageRoot, entrypoint);
    if (!fs.existsSync(entrypoint)) throw new BadRequestException(`MCP 入口不存在：${candidate}`);
    return entrypoint;
  }

  private validatePackageName(value: string): void {
    if (!value || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value)) throw new BadRequestException('npm 包名格式不正确');
  }

  private validateVersion(value: string): void {
    if (!value || !/^[a-z0-9._+\-^~*<>=|. ]+$/i.test(value) || /[;&|`$\\/]/.test(value)) throw new BadRequestException('npm 版本必须是安全的版本范围');
  }

  private assertInside(root: string, target: string): void {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new BadRequestException('非法安装路径');
  }
}
