import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('mcp_server')
export class McpServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ default: '' })
  description: string;

  @Column({ default: 'configured' })
  status: string;

  @Column({ default: 'script' })
  sourceType: 'builtin' | 'script' | 'npm' | 'remote';

  @Column({ default: 'stdio' })
  transport: 'stdio' | 'http';

  @Column({ type: 'text', default: '[]' })
  tools: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: false })
  builtin: boolean;

  @Column({ default: '' })
  command: string;

  @Column({ type: 'text', default: '[]' })
  args: string;

  @Column({ type: 'text', default: '{}' })
  env: string;

  @Column({ type: 'text', default: '{}' })
  headers: string;

  @Column({ nullable: true })
  url: string;

  @Column({ nullable: true })
  packageName: string;

  @Column({ nullable: true })
  packageVersion: string;

  @Column({ nullable: true })
  installDir: string;

  @Column({ nullable: true })
  entrypoint: string;

  @Column({ default: 'none' })
  installStatus: 'none' | 'installing' | 'ready' | 'failed';

  @Column({ type: 'text', nullable: true })
  installLog: string;

  @Column({ type: 'integer', default: 30000 })
  timeout: number;

  @Column({ type: 'text', nullable: true })
  serverScript: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
