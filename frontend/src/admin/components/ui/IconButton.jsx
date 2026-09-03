import React from 'react';
import { FiEdit, FiTrash2, FiEye, FiCheck, FiX, FiRefreshCcw, FiMoreVertical } from 'react-icons/fi';

const IconButton = ({ type, onClick, title, disabled, className = "", ariaLabel, ariaExpanded }) => {
  const getIcon = () => {
    switch (type) {
      case 'edit': return <FiEdit size={16} />;
      case 'delete': return <FiTrash2 size={16} />;
      case 'refresh': return <FiRefreshCcw size={16} />;
      case 'view': return <FiEye size={16} />;
      case 'check': return <FiCheck size={16} />;
      case 'close': return <FiX size={16} />;
      case 'more': return <FiMoreVertical size={16} />;
      default: return null;
    }
  };

  const getCustomClass = () => {
    switch (type) {
      case 'edit': return 'text-[var(--text-secondary)] hover:text-[#D4AF37] hover:bg-[rgba(255,255,255,0.05)]';
      case 'delete': return 'text-[var(--text-secondary)] hover:text-[#ff4d4f] hover:bg-[rgba(255,0,0,0.08)]';
      case 'refresh': return 'text-[var(--text-secondary)] hover:text-[#6ca8ff] hover:bg-[rgba(108,168,255,0.08)]';
      case 'view': return 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.05)]';
      case 'check': return 'text-[var(--text-secondary)] hover:text-[#3ddc84] hover:bg-[rgba(61,220,132,0.1)]';
      case 'close': return 'text-[var(--text-secondary)] hover:text-[#818181] hover:bg-[rgba(129,129,129,0.1)]';
      case 'more': return 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.05)]';
      default: return '';
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title || type.charAt(0).toUpperCase() + type.slice(1)}
      aria-label={ariaLabel || title || type.charAt(0).toUpperCase() + type.slice(1)}
      aria-expanded={ariaExpanded}
      className={`inline-flex items-center justify-center w-[34px] h-[34px] rounded-lg bg-transparent transition-all duration-200 ${getCustomClass()} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {getIcon()}
    </button>
  );
};

export default IconButton;
