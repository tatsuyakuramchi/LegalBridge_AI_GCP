
import React from 'react';

interface FormSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'blue' | 'amber' | 'emerald' | 'indigo' | 'cyan' | 'red' | 'default';
  className?: string;
  headerActions?: React.ReactNode;
}

export const FormSection: React.FC<FormSectionProps> = ({ 
  title, 
  icon, 
  children, 
  variant = 'default',
  className = '',
  headerActions
}) => {
  const styles = {
    blue: 'border-blue-600/10 bg-blue-50/10 text-blue-900',
    amber: 'border-amber-600/10 bg-amber-50/10 text-amber-900',
    emerald: 'border-emerald-600/10 bg-emerald-50/10 text-emerald-900',
    indigo: 'border-indigo-600/10 bg-indigo-50/10 text-indigo-900',
    cyan: 'border-cyan-600/10 bg-cyan-50/10 text-cyan-900',
    red: 'border-red-600/10 bg-red-50/5 text-red-900',
    default: 'border-[#141414]/10 bg-white text-[#141414]'
  };

  const iconColors = {
    blue: 'text-blue-600',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    indigo: 'text-indigo-600',
    cyan: 'text-cyan-600',
    red: 'text-red-600',
    default: 'text-[#141414]/40'
  };

  return (
    <div className={`p-8 border rounded-sm transition-all ${styles[variant]} ${className}`}>
      <div className={`flex items-center justify-between border-b pb-3 mb-6 ${variant === 'default' ? 'border-[#141414]/5' : 'border-current opacity-30'}`}>
        <div className="flex items-center gap-3">
          {icon && <span className={iconColors[variant]}>{icon}</span>}
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest">{title}</h3>
        </div>
        {headerActions && <div className="flex gap-2">{headerActions}</div>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {children}
      </div>
    </div>
  );
};
