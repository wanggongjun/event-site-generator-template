/** Fixed operational tables. Event facts remain exclusively in the source XLSX. */
export const REVIEW_STATUSES = ['under_review', 'accepted', 'rejected', 'needs_materials'];
const text = field_name => ({ field_name, type: 1 });
const common = ['用户ID', '手机号', '姓名', '单位', '邮箱', '职业阶段', '资料JSON'].map(text);
const review = [
  { field_name: '审核状态', type: 3, property: { options: REVIEW_STATUSES.map(name => ({ name })) } },
  text('反馈'), text('内部备注'), { field_name: '审核轮次', type: 2 },
];
export const FEISHU_TABLES = [
  { kind: 'attendance', name: '报名', envKey: 'FEISHU_ATTENDANCE_TABLE_ID', key: '用户ID', distinctive: ['报名原因'], fields: [...common, ...review, text('报名原因')] },
  { kind: 'submission', name: '投稿', envKey: 'FEISHU_SUBMISSION_TABLE_ID', key: '用户ID', distinctive: ['标题', '附件'], fields: [...common, ...review, text('标题'), { field_name: '附件', type: 17 }] },
  { kind: 'question', name: '问答', envKey: 'FEISHU_QUESTION_TABLE_ID', key: '问题ID', distinctive: ['问题ID', '问题'], fields: ['问题ID', '用户ID', '手机号', '姓名', '问题', '回复'].map(text).concat({ field_name: '提交时间', type: 5, property: { date_formatter: 'yyyy-MM-dd HH:mm' } }) },
];

// Official API references checked 2026-10-07. Tests use mocked HTTP; these are not a live acceptance claim.
export const FEISHU_API_SOURCES = [
  'https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal',
  'https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/list',
  'https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/create',
  'https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list',
  'https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/create',
  'https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/list',
  'https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create',
  'https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update',
  'https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node',
  'https://open.feishu.cn/document/server-docs/docs/drive-v1/media/upload_all',
  'https://www.feishu.cn/content/137710114294',
  'https://github.com/larksuite/oapi-sdk-go-demo/blob/main/composite_api/base/create_app_and_tables.go',
  'https://github.com/larksuite/oapi-sdk-go/blob/v3_main/service/bitable/v1/model.go',
  'https://github.com/larksuite/oapi-sdk-go/blob/v3_main/service/bitable/v1/resource.go',
  'https://github.com/larksuite/oapi-sdk-go/blob/v3_main/service/wiki/v2/model.go',
];
