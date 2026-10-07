/** `dshEditor` namespace. Simplified Chinese follows DSH's own `zh`; projects may add more locales. */
export const zh = {
  unsupported: '此文件没有可用的编辑器',
  'status.loading': '载入中…',
  'status.clean': '已保存',
  'status.dirty': '未保存',
  'status.saving': '保存中…',
  'conflict.message': '此文件在磁盘上已被修改，与你未保存的内容冲突。',
  'conflict.useDisk': '使用磁盘版本',
  'conflict.keepMine': '保留我的版本',
  missing: '文件已被删除，继续编辑会重新创建。',
  'error.save': '保存失败：{reason}',
  'error.open': '无法以文本打开此文件（{reason}）',
  retry: '重试',
}

export const en: typeof zh = {
  unsupported: 'No editor is available for this file',
  'status.loading': 'Loading…',
  'status.clean': 'Saved',
  'status.dirty': 'Unsaved',
  'status.saving': 'Saving…',
  'conflict.message': 'This file changed on disk and conflicts with your unsaved edits.',
  'conflict.useDisk': 'Use disk version',
  'conflict.keepMine': 'Keep mine',
  missing: 'The file was deleted. Editing will recreate it.',
  'error.save': 'Save failed: {reason}',
  'error.open': 'Cannot open this file as text ({reason})',
  retry: 'Retry',
}
