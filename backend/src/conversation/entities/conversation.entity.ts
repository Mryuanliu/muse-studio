import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Message } from './message.entity';

@Entity()
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: '新对话' })
  title: string;

  /** SDK session ID for resume support */
  @Column({ nullable: true })
  sdkSessionId: string;

  /** Sandbox output directory used for this conversation */
  @Column({ nullable: true })
  outputDir: string;

  /** Task status: active / archived */
  @Column({ default: 'active' })
  status: string;

  /** Run status: idle / running / completed / error */
  @Column({ default: 'idle' })
  runStatus: string;

  /** Generated output file paths (JSON array of strings) */
  @Column({ type: 'text', nullable: true })
  outputFiles: string;

  @Column({ nullable: true })
  agentId: string;

  @Column({ nullable: true })
  agentName: string;

  @Column({ nullable: true })
  agentType: 'codegen' | 'other';

  /** Runtime snapshot keeps old conversations stable when an agent changes. */
  @Column({ type: 'text', nullable: true })
  agentSnapshot: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Message, (msg) => msg.conversation, { cascade: true })
  messages: Message[];
}
