'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Radio, Space, Typography } from 'antd';
import { CheckCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';

export interface AskUserOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface AskUserQuestion {
  question: string;
  header?: string;
  options?: AskUserOption[];
  multiSelect?: boolean;
}

export interface AskUserCardData {
  requestId: string;
  conversationId?: string;
  toolUseID?: string;
  questions: AskUserQuestion[];
  status?: 'pending' | 'submitted';
  submittedAnswers?: Record<string, string>;
}

interface AskUserCardProps {
  card: AskUserCardData;
  onSubmit: (payload: { requestId: string; answers: Record<string, string> }) => Promise<void>;
}

const OTHER_KEY = '__other__';

export default function AskUserCard({ card, onSubmit }: AskUserCardProps) {
  const [selected, setSelected] = useState<Record<string, unknown>>({});
  const [otherValues, setOtherValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  const questions = Array.isArray(card.questions) ? card.questions : [];
  const submitted = card.status === 'submitted';

  const isOtherSelected = (question: string) => {
    const value = selected[question];
    return Array.isArray(value) ? value.includes(OTHER_KEY) : value === OTHER_KEY;
  };

  const setQuestionValue = (question: string, value: unknown) => {
    setSelected((prev) => ({ ...prev, [question]: value }));
  };

  const handleSubmit = async () => {
    const answers: Record<string, string> = {};
    for (const question of questions) {
      const value = selected[question.question];
      const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value);
      if (!hasValue) {
        setSubmitError(`请回答「${question.header || question.question}」`);
        return;
      }

      const selectedLabels = Array.isArray(value)
        ? value.filter((item: unknown) => item !== OTHER_KEY)
        : [];
      const custom = otherValues[question.question];

      if (isOtherSelected(question.question)) {
        if (!custom?.trim()) {
          setSubmitError(`请填写「${question.header || question.question}」的自定义答案`);
          return;
        }
        answers[question.question] = [...selectedLabels, custom.trim()].join(', ');
      } else {
        answers[question.question] = Array.isArray(value)
          ? value.join(',')
          : String(value);
      }
    }

    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await onSubmit({ requestId: card.requestId, answers });
    } catch (error: any) {
      setSubmitError(error?.message || '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <QuestionCircleOutlined className="text-blue-500" />
          需要确认
        </span>
        {submitted && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
            <CheckCircleOutlined />
            已提交
          </span>
        )}
      </div>

      {questions.length === 0 && (
        <Alert type="warning" showIcon message="没有收到可回答的问题" />
      )}

      {questions.map((question, index) => {
        const options = question.options || [];
        return (
          <div key={question.question || index} className="mb-3">
            <Typography.Text strong className="block text-sm">
              {index + 1}. {question.question}
            </Typography.Text>
            <Typography.Text type="secondary" className="mb-2 block text-xs">
              {question.header || '请选择'}
            </Typography.Text>

            {question.multiSelect ? (
              <Checkbox.Group
                value={Array.isArray(selected[question.question])
                  ? selected[question.question] as string[]
                  : []}
                onChange={(value) => setQuestionValue(question.question, value)}
                disabled={submitted}
                className="w-full"
              >
                <Space direction="vertical" className="w-full">
                  {options.map((option) => (
                    <Checkbox key={option.label} value={option.label} className="w-full py-0.5">
                      <div>
                        <span className="text-sm font-medium text-slate-700">{option.label}</span>
                        {option.description && (
                          <p className="mb-0 text-xs text-slate-400">{option.description}</p>
                        )}
                      </div>
                    </Checkbox>
                  ))}
                  <Checkbox value={OTHER_KEY} className="w-full py-0.5">
                    其他
                  </Checkbox>
                </Space>
              </Checkbox.Group>
            ) : (
              <Radio.Group
                value={selected[question.question] as string | undefined}
                onChange={(event) => setQuestionValue(question.question, event.target.value)}
                disabled={submitted}
                className="w-full"
              >
                <Space direction="vertical" className="w-full">
                  {options.map((option) => (
                    <Radio key={option.label} value={option.label} className="w-full py-0.5">
                      <div>
                        <span className="text-sm font-medium text-slate-700">{option.label}</span>
                        {option.description && (
                          <p className="mb-0 text-xs text-slate-400">{option.description}</p>
                        )}
                      </div>
                    </Radio>
                  ))}
                  <Radio value={OTHER_KEY} className="w-full py-0.5">
                    其他
                  </Radio>
                </Space>
              </Radio.Group>
            )}

            {isOtherSelected(question.question) && (
              <Input
                value={otherValues[question.question]}
                onChange={(event) =>
                  setOtherValues((prev) => ({
                    ...prev,
                    [question.question]: event.target.value,
                  }))
                }
                disabled={submitted}
                placeholder="输入自定义答案"
                className="mt-2"
              />
            )}
          </div>
        );
      })}

      {submitted && card.submittedAnswers && (
        <div className="mb-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
          {Object.entries(card.submittedAnswers).map(([question, answer]) => (
            <div key={question} className="flex gap-2 py-0.5">
              <span className="font-medium text-slate-500">{question}:</span>
              <span>{answer}</span>
            </div>
          ))}
        </div>
      )}

      {submitError && (
        <Alert type="error" showIcon message={submitError} className="mb-2" />
      )}

      <Button
        type="primary"
        size="small"
        loading={submitting}
        disabled={submitted}
        onClick={handleSubmit}
      >
        {submitted ? '已提交' : '提交回答'}
      </Button>
    </div>
  );
}
