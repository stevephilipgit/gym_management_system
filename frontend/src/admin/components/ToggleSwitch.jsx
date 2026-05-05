import React from 'react';

const ToggleSwitch = ({ active, onClick, disabled, className = "" }) => {
  return (
    <div 
      className={`toggle ${active ? 'active' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      onClick={() => {
        if (!disabled && onClick) {
          onClick(!active);
        }
      }}
      role="switch"
      aria-checked={active}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(!active);
        }
      }}
    />
  );
};

export default ToggleSwitch;
