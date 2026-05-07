
import React from 'react';
import { Building2, User, Trash2, Plus, GitBranch } from 'lucide-react';
import { FormField } from './FormField';

interface PartySectionProps {
  prefix: string;
  formData: any;
  setFormData: (data: any) => void;
  renderField: (field: string, label?: string) => React.ReactNode;
}

export const PartySection: React.FC<PartySectionProps> = ({ prefix, formData, setFormData, renderField }) => {
  const isIndividual = formData[`${prefix}_is_individual`] === true;
  
  return (
    <div className="space-y-4">
      <div className="flex bg-gray-100/50 p-1 rounded-sm gap-1">
        <button 
          onClick={() => setFormData({ ...formData, [`${prefix}_is_individual`]: false })}
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[9px] font-mono font-bold transition-all ${!isIndividual ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Building2 className="w-3.5 h-3.5" /> 法人
        </button>
        <button 
          onClick={() => setFormData({ ...formData, [`${prefix}_is_individual`]: true })}
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[9px] font-mono font-bold transition-all ${isIndividual ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <User className="w-3.5 h-3.5" /> 個人
        </button>
      </div>
      
      <div className="space-y-4">
        {renderField(`${prefix}_名称`, isIndividual ? '氏名' : '会社名')}
        {!isIndividual && renderField(`${prefix}_代表者名`, '代表者名')}
        {renderField(`${prefix}_住所`)}
      </div>
    </div>
  );
};

interface SubLicenseeTableProps {
  formData: any;
  setFormData: (data: any) => void;
}

export const SubLicenseeTable: React.FC<SubLicenseeTableProps> = ({ formData, setFormData }) => {
  const list = formData.サブライセンシー一覧 || [];

  const addItem = () => {
    const newItem = { id: Date.now(), 区分: '製造販売', 名称: '', 地域: '', 言語: '', 金銭条件: '', MGAG: '', 料率: '', 備考: '' };
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

  return (
    <div className="p-8 border border-[#141414]/10 bg-[#FAFAFA] space-y-8 rounded-sm">
      <div className="flex items-center justify-between border-b border-[#141414]/10 pb-3">
        <div className="flex items-center gap-3">
          <GitBranch className="w-4 h-4 text-[#141414]/60" />
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#141414]">Entity Relations (サブライセンシー一覧)</h3>
        </div>
        <button 
          onClick={addItem}
          className="px-5 py-2 bg-[#141414] text-white text-[10px] font-mono uppercase tracking-widest hover:invert transition-all flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" /> Append Entity
        </button>
      </div>
      
      <div className="grid grid-cols-1 gap-6">
        {list.map((item: any, idx: number) => (
          <div key={item.id || `sublicensee-${idx}`} className="bg-white border border-[#141414]/10 p-6 shadow-sm relative group">
            <button 
              onClick={() => removeItem(idx)}
              className="absolute -right-3 -top-3 w-7 h-7 bg-red-600 text-white rounded-full flex items-center justify-center shadow-xl opacity-0 hover:scale-110 group-hover:opacity-100 transition-all z-10"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6 pb-6 border-b border-dashed border-gray-100">
              <div className="space-y-1.5">
                <label className="text-[8px] font-mono uppercase opacity-40">Classification</label>
                <select 
                  value={item.区分} 
                  onChange={(e) => updateItem(idx, '区分', e.target.value)}
                  className="w-full text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                >
                  <option value="製造販売">製造販売</option>
                  <option value="翻訳出版">翻訳出版</option>
                  <option value="デジタル">デジタル</option>
                </select>
              </div>
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-[8px] font-mono uppercase opacity-40">Partner 名称</label>
                <input 
                  type="text"
                  value={item.名称}
                  onChange={(e) => updateItem(idx, '名称', e.target.value)}
                  className="w-full text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                  placeholder="Enter Legal Name..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[8px] font-mono uppercase opacity-40">Region / Lang</label>
                <div className="flex gap-2">
                  <input 
                    type="text" value={item.地域}
                    onChange={(e) => updateItem(idx, '地域', e.target.value)}
                    className="w-1/2 text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                    placeholder="Region"
                  />
                  <input 
                    type="text" value={item.言語}
                    onChange={(e) => updateItem(idx, '言語', e.target.value)}
                    className="w-1/2 text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                    placeholder="Lang"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {['金銭条件', 'MGAG', '料率', '備考'].map(subField => (
                <div key={subField} className="space-y-1.5">
                  <label className="text-[8px] font-mono uppercase opacity-40">{subField}</label>
                  <input 
                    type="text"
                    value={item[subField] || ''}
                    onChange={(e) => updateItem(idx, subField, e.target.value)}
                    className="w-full text-xs font-mono border-b border-[#141414]/20 py-2 bg-transparent focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
