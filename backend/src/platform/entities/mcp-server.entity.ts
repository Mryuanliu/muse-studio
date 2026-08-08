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

  @Column({ type: 'text', nullable: true })
  serverScript: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
