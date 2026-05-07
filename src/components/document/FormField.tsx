
import React from 'react';
import { HelpCircle } from 'lucide-react';
import { TemplateVar } from './types';

interface FormFieldProps {
  id: string;
  meta: TemplateVar;
  value: any;
  error?: string | null;
  onChange: (value: any) => void;
}

const SELECT_OPTIONS: Record<string, string[]> = {
  '金銭条件1_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
  '金銭条件2_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
  '金銭条件3_計算方式': ['FIXED', 'SUBSCRIPTION', 'ROYALTY'],
  '金銭条件1_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
  '金銭条件2_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
  '金銭条件3_計算期間': ['製造時', '月次', '四半期', '半年', '年次'],
  '金銭条件1_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
  '金銭条件2_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
  '金銭条件3_通貨': ['JPY', 'USD', 'EUR', 'CNY'],
  'CURRENCY': ['JPY', 'USD', 'EUR', 'CNY', 'GBP', 'AUD', 'CAD', 'CHF'],
  '独占性': ['独占', '非独占'],
  '対象地域': ['日本国内', '全世界', '北米', '欧州'],
  '許諾言語': ['日本語', '英語', '各国語'],
  '販売地域': ['日本国内', '全世界', '北米', '欧州'],
  '販売言語': ['日本語', '英語', '各国語'],
  'taxRate': ['10', '8']
};

export const FormField: React.FC<FormFieldProps> = ({ id, meta, value, error, onChange }) => {
  const label = meta.label || id.replace(/_/g, ' ');
  const options = meta.options || SELECT_OPTIONS[id];

  const isDate = meta.type === 'date' || id.includes('日') || id.includes('DATE') || id.includes('期限');
  const isTextarea = meta.type === 'textarea' || id.includes('本文') || id.includes('備考') || id.includes('REMARKS') || id.includes('特記');
  const isBoolean = meta.type === 'boolean' || id.startsWith('is') || id.includes('フラグ');
  const isNumber = meta.type === 'number';

  const commonClass = `w-full text-xs font-mono transition-colors focus:outline-none ${
    error ? 'border-red-300' : 'border-[#141414]/20 focus:border-blue-600'
  }`;

  return (
    <div className="space-y-1 group relative">
      <div className="flex justify-between items-center">
        <label className={`flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-colors ${error ? 'text-red-500' : 'text-[#141414]/50 group-hover:text-blue-600'}`}>
          {label}
          {error && <span className="text-[7px] bg-red-100 px-1 rounded-full ml-1">!</span>}
        </label>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <HelpCircle className="w-2.5 h-2.5 text-gray-300 cursor-help" />
        </div>
      </div>

      {isBoolean ? (
        <div className="flex items-center gap-4 py-1.5">
          <button
            onClick={() => onChange(true)}
            className={`text-[10px] font-mono px-3 py-1 border transition-all ${value === true ? 'bg-[#141414] text-white' : 'border-[#141414]/10 opacity-50'}`}
          >TRUE</button>
          <button
            onClick={() => onChange(false)}
            className={`text-[10px] font-mono px-3 py-1 border transition-all ${value === false ? 'bg-[#141414] text-white' : 'border-[#141414]/10 opacity-50'}`}
          >FALSE</button>
        </div>
      ) : options ? (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${commonClass} border-b bg-transparent py-1.5 appearance-none`}
        >
          <option value="">-- SELECT --</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : isTextarea ? (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className={`${commonClass} border bg-white/50 p-2 resize-none`}
          placeholder={`Enter ${label}...`}
        />
      ) : (
        <input
          type={isDate ? 'date' : isNumber ? 'number' : 'text'}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${commonClass} border-b bg-transparent py-1.5 placeholder:text-gray-300`}
          placeholder={isDate ? '' : `Input ${label}...`}
        />
      )}
    </div>
  );
};
