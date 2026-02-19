import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  startTime: number | null;
  isActive: boolean;
  totalIdleTimeMs?: number;
  currentIdleStartTime?: number | null;
}

export const Timer: React.FC<Props> = ({ startTime, isActive, totalIdleTimeMs = 0, currentIdleStartTime = null }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let interval: number;

    if (startTime) {
      const updateElapsed = () => {
        const now = (!isActive && currentIdleStartTime) ? currentIdleStartTime : Date.now();
        const totalIdle = totalIdleTimeMs;
        setElapsed(Math.max(0, now - startTime - totalIdle));
      };

      updateElapsed();
      if (isActive) {
        interval = window.setInterval(updateElapsed, 1000);
      }
    }

    return () => clearInterval(interval);
  }, [isActive, startTime, totalIdleTimeMs, currentIdleStartTime]);

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