'use client';

import { useEffect, useRef, useState } from 'react';
import { cn, formatNumber } from '@/lib/utils';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export default function AnimatedCounter({
  value,
  duration = 2000,
  prefix = '',
  suffix = '',
  className,
}: AnimatedCounterProps) {
  const isDecimal = value > 0 && value < 1;
  const [display, setDisplay] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    startTime.current = null;

    function tick(timestamp: number) {
      if (startTime.current === null) startTime.current = timestamp;
      const elapsed = timestamp - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutExpo(progress);

      const current = easedProgress * value;
      setDisplay(isDecimal ? parseFloat(current.toFixed(2)) : Math.round(current));

      if (progress < 1) {
        rafId.current = requestAnimationFrame(tick);
      }
    }

    rafId.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId.current);
  }, [value, duration, isDecimal]);

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {isDecimal ? display.toFixed(2) : formatNumber(display)}
      {suffix}
    </span>
  );
}
