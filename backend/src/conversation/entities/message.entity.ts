import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

@Entity()
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  role: 'user' | 'assistant';

  @Column({ type: 'text' })
  content: string;

  /** Versioned, provider-independent event log as JSON array. */
  @Column({ type: 'text', nullable: true })
  museEvents: string;

  /** User-uploaded attachments as a JSON array. */
  @Column({ type: 'text', nullable: true })
  attachments: string;

  @ManyToOne(() => Conversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column()
  conversationId: string;

  @CreateDateColumn()
  createdAt: Date;
}
