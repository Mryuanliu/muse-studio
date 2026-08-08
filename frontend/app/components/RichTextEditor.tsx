'use client';

import React, { useEffect, useRef } from 'react';
import { Button, Space, Tooltip } from 'antd';
import { BoldOutlined, ItalicOutlined, OrderedListOutlined, UnderlineOutlined, UnorderedListOutlined } from '@ant-design/icons';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function RichTextEditor({ value = '', onChange, placeholder, minHeight = 260 }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (editorRef.current && !focusedRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value;
  }, [value]);

  const command = (name: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, commandValue);
    onChange?.(editorRef.current?.innerHTML || '');
  };

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar">
        <Space size={2}>
          <Tooltip title="加粗"><Button size="small" type="text" icon={<BoldOutlined />} onMouseDown={(event) => { event.preventDefault(); command('bold'); }} /></Tooltip>
          <Tooltip title="斜体"><Button size="small" type="text" icon={<ItalicOutlined />} onMouseDown={(event) => { event.preventDefault(); command('italic'); }} /></Tooltip>
          <Tooltip title="下划线"><Button size="small" type="text" icon={<UnderlineOutlined />} onMouseDown={(event) => { event.preventDefault(); command('underline'); }} /></Tooltip>
          <Tooltip title="无序列表"><Button size="small" type="text" icon={<UnorderedListOutlined />} onMouseDown={(event) => { event.preventDefault(); command('insertUnorderedList'); }} /></Tooltip>
          <Tooltip title="有序列表"><Button size="small" type="text" icon={<OrderedListOutlined />} onMouseDown={(event) => { event.preventDefault(); command('insertOrderedList'); }} /></Tooltip>
        </Space>
      </div>
      <div
        ref={editorRef}
        className="rich-text-content"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight }}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => { focusedRef.current = false; onChange?.(editorRef.current?.innerHTML || ''); }}
        onInput={() => onChange?.(editorRef.current?.innerHTML || '')}
      />
    </div>
  );
}
