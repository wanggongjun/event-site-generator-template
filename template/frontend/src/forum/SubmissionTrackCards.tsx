import {SubmissionDetails,statusName} from './SubmissionDetails';
import config from '../config.generated.json';

import {tracks} from './tracks';

export function SubmissionTrackCards({disabled, records, onSelect, onEdit, onResume, onWithdraw}: {
  disabled: boolean;
  records: any[];
  onSelect: (track: string) => void;
  onEdit: (record: any) => void;
  onResume: (record: any) => void;
  onWithdraw: (record: any) => void;
}) {
  return <section aria-label="投稿入口">
    <p>各类别可分别投稿，每人每类限一篇。已提交的稿件可修改，修改提交后重新审核。</p>
    <div className="evening-activity-list submission-track-cards">
      {tracks.map(track => {
        const papers=records.filter(record=>record.data.track===track.key);
        const previousDrafts=papers.some(record=>record.version>0)?papers.filter(record=>!record.version&&!record.pending):[];
        const currentPapers=papers.filter(record=>!previousDrafts.includes(record));
        return <article key={track.key} className="evening-activity-card" aria-labelledby={'submission-card-' + track.key}>
        <div className="submission-card-heading"><h4 id={'submission-card-' + track.key}>{track.title}</h4>{!papers.length&&<strong role="status" className="status-badge status-badge--draft">尚未投稿</strong>}</div>
        {currentPapers.map(record=><section className="submission-card-record" key={record.id} aria-label={track.title+'投稿记录'}>
          <div className="submission-card-status">
            <strong role="status" className={'status-badge status-badge--'+(record.withdrawn?'withdrawn':record.status||'draft')}>{record.pending?'提交尚未完成，请继续提交':record.withdrawn?'已撤回':record.version?(statusName(record)==='待审核'?'已提交，待审核':statusName(record)):'草稿，尚未提交'}</strong>
            <p>{record.data.title||'未命名草稿'}{record.number?' · 稿件编号：'+record.number:''}</p>
          </div>
          {record.feedback&&<div className="review-feedback"><strong>审核意见</strong><p>{record.feedback}</p></div>}
          <div className="submission-card-actions">
            {record.pending?<button className="account-button" type="button" disabled={disabled} onClick={()=>onResume(record)}>继续提交</button>:<button className="account-button" type="button" disabled={disabled} onClick={()=>onEdit(record)}>{record.version?'编辑或补充材料':'继续填写'}</button>}
            {record.version>0&&!record.withdrawn&&<button className="account-button account-button--danger account-button--inline-danger" type="button" disabled={disabled} onClick={()=>onWithdraw(record)}>撤回</button>}
          </div>
          <div className="submission-card-details"><SubmissionDetails record={record}/></div>
        </section>)}
        {previousDrafts.length>0&&<details className="submission-card-details"><summary>此前保存的草稿</summary>{previousDrafts.map(record=><section key={record.id}><p>{record.data.title||'未命名草稿'}</p><SubmissionDetails record={record}/></section>)}</details>}
        <div className="evening-activity-card__body">
          
          <dl><div><dt>形式</dt><dd>{track.form==='academic'?'学术报告':'实践分享'}</dd></div><div><dt>材料</dt><dd>{track.materials}</dd></div></dl>
          <p className="evening-activity-summary">{track.description}</p>
        </div>
        {!papers.length&&<footer className="evening-activity-card__footer">
          <button className="account-button" type="button" disabled={disabled} onClick={() => onSelect(track.key)}>{'填写'+track.title+'投稿'}</button>
        </footer>}
      </article>})}
    </div>
  </section>;
}
