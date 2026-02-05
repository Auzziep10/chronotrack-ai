import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  startTime: number | null;
  isActive: boolean;
}

export const Timer: React.FC<Props> = ({ startTime, isActive }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let interval: number;

    if (isActive && startTime) {
      setElapsed(Date.now() - startTime); // Initial sync
      interval = window.setInterval(() => {
        setElapsed(Date.now() - startTime);
      }, 1000);
    } else {
      setElapsed(0);
    }

    return () => clearInterval(interval);
  }, [isActive, startTime]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  return (
    <div className="inline-flex items-center gap-2 font-mono font-bold text-gray-800">
      <Clock className={`w-4 h-4 ${isActive ? 'text-blue-600 animate-pulse' : 'text-gray-400'}`} />
      <span>{formatTime(elapsed)}</span>
    </div>
  );
};