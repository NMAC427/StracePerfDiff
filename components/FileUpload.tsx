import React, { useRef } from 'react';
import { Upload } from 'lucide-react';

interface FileUploadProps {
  label: string;
  onFileSelect: (content: string, name: string) => void;
  fileName?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ label, onFileSelect, fileName }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      onFileSelect(content, file.name);
    };
    reader.readAsText(file);
  };

  return (
    <div 
      onClick={() => inputRef.current?.click()}
      className={`
        relative group cursor-pointer
        border-2 border-dashed rounded-xl p-6
        transition-all duration-200
        flex flex-col items-center justify-center gap-3
        ${fileName 
          ? 'border-indigo-500/50 bg-indigo-500/10 hover:bg-indigo-500/20' 
          : 'border-slate-700 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800'
        }
      `}
    >
      <input 
        type="file" 
        ref={inputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept=".txt,.log,.strace"
      />
      
      <div className={`
        p-3 rounded-full transition-colors
        ${fileName ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-700 text-slate-400 group-hover:bg-slate-600 group-hover:text-slate-300'}
      `}>
        <Upload size={24} />
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-slate-200">
          {fileName || label}
        </p>
        {!fileName && (
          <p className="text-xs text-slate-500 mt-1">
            Click to browse strace log
          </p>
        )}
      </div>
    </div>
  );
};