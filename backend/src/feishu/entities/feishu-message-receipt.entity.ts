import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Idempotency record for Feishu's message receive event. */
@Entity('feishu_message_receipt')
export class FeishuMessageReceipt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  messageId: string;

  @Column()
  tenantKey: string;

  @CreateDateColumn()
  createdAt: Date;
}
