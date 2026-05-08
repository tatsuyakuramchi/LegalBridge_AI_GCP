import React from 'react';
import { Building2, User, Trash2, Plus, GitBranch } from 'lucide-react';

import { cn } from '@/lib/utils';

interface PartySectionProps {
  prefix: string;
  formData: any;
  setFormData: (data: any) => void;
  renderField: (field: string, label?: string) => React.ReactNode;
}

export const PartySection: React.FC<PartySectionProps> = ({
  prefix,
  formData,
  setFormData,
  renderField,
}) => {
  const isIndividual = formData[`${prefix}_is_individual`] === true;

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex p-0.5 gap-0.5 bg-muted/40 rounded-sm border border-border w-fit">
        <button
          type="button"
          role="tab"
          aria-selected={!isIndividual}
          onClick={() => setFormData({ ...formData, [`${prefix}_is_individual`]: false })}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-[0.14em] rounded-sm transition-all',
            !isIndividual
              ? 'bg-card text-foreground shadow-xs border border-border'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Building2 className="h-3 w-3" /> 法人
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isIndividual}
          onClick={() => setFormData({ ...formData, [`${prefix}_is_individual`]: true })}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-[0.14em] rounded-sm transition-all',
            isIndividual
              ? 'bg-card text-foreground shadow-xs border border-border'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <User className="h-3 w-3" /> 個人
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderField(`${prefix}_名称`, isIndividual ? '氏名' : '会社名')}
        {!isIndividual && renderField(`${prefix}_代表者名`, '代表者名')}
        <div className="md:col-span-2">{renderField(`${prefix}_住所`)}</div>
      </div>
    </div>
  );
};

interface SubLicenseeTableProps {
  formData: any;
  setFormData: (data: any) => void;
}

export const SubLicenseeTable: React.FC<SubLicenseeTableProps> = ({
  formData,
  setFormData,
}) => {
  const list = formData.サブライセンシー一覧 || [];

  const addItem = () => {
    const newItem = {
      id: Date.now(),
      区分: '製造販売',
      名称: '',
      地域: '',
      言語: '',
      金銭条件: '',
      MGAG: '',
      料率: '',
      備考: '',
    };
    setFormData({ ...formData, サブライセンシー一覧: [...list, newItem] });
  };

  const removeItem = (idx: number) => {
    const newList = [...list];
    newList.splice(idx, 1);
    setFormData({ ...formData, サブライセンシー一覧: newList });
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const newList = [...list];
    newList[idx] = { ...newList[idx], [field]: value };
    setFormData({ ...formData, サブライセンシー一覧: newList });
  };

  const inputCls =
    'w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground transition-colors';
  const labelCls =
    'text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground';

  return (
    <section className="bg-card border border-border rounded-md overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-mono font-bold uppercase tracking-[0.18em]">
            Entity Relations · サブライセンシー一覧
          </h3>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-foreground text-background text-[10px] font-mono font-bold uppercase tracking-[0.14em] rounded-sm hover:opacity-90 transition-all"
        >
          <Plus className="h-3 w-3" /> Append entity
        </button>
      </header>

      <div className="p-5 space-y-4">
        {list.length === 0 && (
          <p className="text-center text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground py-6">
            No sub-licensee records.
          </p>
        )}
        {list.map((item: any, idx: number) => (
          <div
            key={item.id || `sublicensee-${idx}`}
            className="relative bg-card border border-border rounded-sm p-4 group"
          >
            <button
              type="button"
              onClick={() => removeItem(idx)}
              className="absolute -right-2.5 -top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow opacity-0 group-hover:opacity-100 hover:scale-110 transition-all z-10"
              aria-label="Remove entity"
            >
              <Trash2 className="h-3 w-3" />
            </button>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pb-4 border-b border-dashed border-border">
              <div className="space-y-1">
                <label className={labelCls}>区分</label>
                <select
                  value={item.区分}
                  onChange={(e) => updateItem(idx, '区分', e.target.value)}
                  className={inputCls}
                >
                  <option value="製造販売">製造販売</option>
                  <option value="翻訳出版">翻訳出版</option>
                  <option value="デジタル">デジタル</option>
                </select>
              </div>
              <div className="md:col-span-2 space-y-1">
                <label className={labelCls}>Partner 名称</label>
                <input
                  type="text"
                  value={item.名称}
                  onChange={(e) => updateItem(idx, '名称', e.target.value)}
                  className={inputCls}
                  placeholder="Legal name…"
                />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>地域 / 言語</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={item.地域}
                    onChange={(e) => updateItem(idx, '地域', e.target.value)}
                    className={inputCls}
                    placeholder="Region"
                  />
                  <input
                    type="text"
                    value={item.言語}
                    onChange={(e) => updateItem(idx, '言語', e.target.value)}
                    className={inputCls}
                    placeholder="Lang"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-3">
              {['金銭条件', 'MGAG', '料率', '備考'].map((sub) => (
                <div key={sub} className="space-y-1">
                  <label className={labelCls}>{sub}</label>
                  <input
                    type="text"
                    value={item[sub] || ''}
                    onChange={(e) => updateItem(idx, sub, e.target.value)}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
