import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('skill_group')
export class SkillGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ default: '' })
  description: string;

  /** Names are used instead of hard foreign keys so deleting a resource is predictable. */
  @Column({ type: 'text', default: '[]' })
  skillNames: string;

  @Column({ type: 'text', default: '[]' })
  mcpNames: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
