import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  className?: string;
};

// Google Icon
export const GoogleIcon = ({ className, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    className={`w-5 h-5 ${className}`}
    {...props}
  >
    <path
      fill="#fbc02d"
      d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12	s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20	s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
    />
    <path
      fill="#e53935"
      d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039	l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
    />
    <path
      fill="#4caf50"
      d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
    />
    <path
      fill="#1565c0"
      d="M43.611,20.083L43.595,20L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
    />
  </svg>
);

// Microphone Icon
export const MicrophoneIcon = ({ className, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    className={`w-5 h-5 ${className}`}
    {...props}
  >
    {/* Mic capsule */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2.75a3.25 3.25 0 0 0-3.25 3.25v6a3.25 3.25 0 0 0 6.5 0v-6A3.25 3.25 0 0 0 12 2.75z"
    />
    {/* Ears / envelope */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5 11.5v1A7 7 0 0 0 12 19.5a7 7 0 0 0 7-7v-1"
    />
    {/* Stand */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 19.5V22M9.5 22h5"
    />
  </svg>
);

// Filled Microphone Icon (for buttons with text-white)
export const MicFilledIcon = ({ className, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={`w-5 h-5 ${className}`}
    {...props}
  >
    {/* Capsule */}
    <rect x="9" y="2" width="6" height="12" rx="3" />
    {/* Ears / envelope */}
    <path d="M5 11a7 7 0 0014 0h-2a5 5 0 01-10 0H5z" />
    {/* Stand */}
    <rect x="11" y="19" width="2" height="3" rx="1" />
    <rect x="9" y="21" width="6" height="2" rx="1" />
  </svg>
);

// Plus Icon
export const PlusIcon = ({ className, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={`w-5 h-5 ${className}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);

// Chevron Icon
export const ChevronIcon = ({ 
  className, 
  direction = "down", 
  ...props 
}: IconProps & { 
  direction?: "up" | "down" | "left" | "right" 
}) => {
  const getPath = () => {
    switch (direction) {
      case "up":
        return "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z";
      case "down":
        return "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z";
      case "left":
        return "M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z";
      case "right":
        return "M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z";
      default:
        return "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z";
    }
  };

  return (
    <svg
      className={`w-5 h-5 transition-transform duration-200 ${className}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d={getPath()} />
    </svg>
  );
};

// User Icon
export const UserIcon = ({ className, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={`w-5 h-5 ${className}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    {...props}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  </svg>
);

// Dots Vertical Icon
export const DotsVerticalIcon = ({ className, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={`w-5 h-5 ${className}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    {...props}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
    />
  </svg>
);

// Trash Icon
export const TrashIcon = ({ className, ...props }: IconProps) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={`w-4 h-4 ${className || ''}`}
    {...props}
  >
    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
  </svg>
);

// Edit (Pencil) Icon
export const EditIcon = ({ className, ...props }: IconProps) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={`w-4 h-4 ${className || ''}`}
    {...props}
  >
    <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32l8.4-8.4z" />
    <path d="M5.25 5.25a3 3 0 00-3 3v10.5a3 3 0 003 3h10.5a3 3 0 003-3V13.5a.75.75 0 00-1.5 0v5.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5V8.25a1.5 1.5 0 011.5-1.5h5.25a.75.75 0 000-1.5H5.25z" />
  </svg>
);

// Refresh Icon
export const RefreshIcon = ({ className, ...props }: IconProps) => (
  <svg 
    className={`w-5 h-5 ${className}`} 
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24" 
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth="2" 
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

// Document Icon
export const DocumentIcon = ({ className, ...props }: IconProps) => (
  <svg 
    className={`w-5 h-5 ${className}`} 
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24" 
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth="2" 
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

// Back Arrow Icon
export const BackArrowIcon = ({ className, ...props }: IconProps) => (
  <svg 
    className={`w-5 h-5 ${className}`} 
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24"
    {...props}
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth={2} 
      d="M10 19l-7-7m0 0l7-7m-7 7h18"
    />
  </svg>
);

// Pencil Icon
export const PencilIcon = ({ className, ...props }: IconProps) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={`w-5 h-5 ${className || ''}`}
    {...props}
  >
    <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32l8.4-8.4z" />
    <path d="M5.25 5.25a3 3 0 00-3 3v10.5a3 3 0 003 3h10.5a3 3 0 003-3V13.5a.75.75 0 00-1.5 0v5.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5V8.25a1.5 1.5 0 011.5-1.5h5.25a.75.75 0 000-1.5H5.25z" />
  </svg>
);

export const CopyIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg 
    className={className} 
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth={2} 
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" 
    />
  </svg>
);

export const CheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg 
    className={className} 
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth={2} 
      d="M5 13l4 4L19 7" 
    />
  </svg>
);

// Light Bulb Icon  
export const LightBulbIcon = ({ className, ...props }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={`w-5 h-5 ${className}`}
    fill="currentColor"
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M12 1.5c-4.14 0-7.5 3.36-7.5 7.5 0 2.48 1.22 4.68 3.1 6.04l1.4.94V18c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-2.02l1.4-.94c1.88-1.36 3.1-3.56 3.1-6.04 0-4.14-3.36-7.5-7.5-7.5zm-2 19h4v1.5c0 .83-.67 1.5-1.5 1.5h-1c-.83 0-1.5-.67-1.5-1.5V20.5z"/>
  </svg>
);
