import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Maps one Feishu chat to one Muse conversation for contextual follow-ups. */
@Entity('feishu_conversation_binding')
@Index(['tenantKey', 'chatId'], { unique: true })
export class FeishuConversationBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantKey: string;

  @Column()
  chatId: string;

  @Column({ nullable: true })
  openId: string;

  @Column()
  museConversationId: string;

  @CreateDateColumn()
  createdAt: Date;
}
