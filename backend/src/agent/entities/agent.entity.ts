import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AgentType = 'codegen' | 'other';

@Entity('agent')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ default: '' })
  description: string;

  @Column({ type: 'text', default: '' })
  prompt: string;

  @Column({ default: 'codegen' })
  type: AgentType;

  @Column({ nullable: true })
  skillGroupId: string;

  @Column({ type: 'text', default: '[]' })
  mcpNames: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
