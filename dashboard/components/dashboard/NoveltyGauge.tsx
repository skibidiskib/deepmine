'use client';

import { motion } from 'framer-motion';
import AnimatedCounter from '@/components/ui/AnimatedCounter';

interface NoveltyGaugeProps {
  percentage: number;
}

export default function NoveltyGauge({ percentage }: NoveltyGaugeProps) {
  const size = 250;
  const cx = size / 2;
  const cy = size / 2;
  const r = 100;
  const strokeWidth = 14;

  // 300-degree arc with 60-degree gap at the bottom
  // Start at 120 degrees (bottom-left), end at 420 degrees (bottom-right)
  const startAngle = 120;
  const endAngle = 420;
  const totalArc = endAngle - startAngle; // 300 degrees

  function polarToCartesian(angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  const start = polarToCartesian(startAngle);
  const end = polarToCartesian(endAngle);

  // Background arc path (full 300 degrees)
  const bgArc = [
    `M ${start.x} ${start.y}`,
    `A ${r} ${r} 0 1 1 ${end.x} ${end.y}`,
  ].join(' ');

  // Filled arc endpoint
  const fillAngle = startAngle + (totalArc * percentage) / 100;
  const fillEnd = polarToCartesian(fillAngle);
  const largeArc = fillAngle - startAngle > 180 ? 1 : 0;

  const fillArc = [
    `M ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${fillEnd.x} ${fillEnd.y}`,
  ].join(' ');

  // Total path length for stroke-dasharray animation
  const circumference = 2 * Math.PI * r;
  const arcLength = (totalArc / 360) * circumference;
  const fillLength = (percentage / 100) * arcLength;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="drop-shadow-lg w-[180px] h-[180px] sm:w-[250px] sm:h-[250px]"
      >
        <defs>
          <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background arc */}
        <path
          d={bgArc}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Filled arc */}
        <motion.path
          d={bgArc}
          fill="none"
          stroke="url(#gaugeGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          filter="url(#glow)"
          strokeDasharray={arcLength}
          initial={{ strokeDashoffset: arcLength }}
          animate={{ strokeDashoffset: arcLength - fillLength }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
        />

        {/* Pulsing dot at arc endpoint */}
        <motion.circle
          cx={fillEnd.x}
          cy={fillEnd.y}
          r={6}
          fill="#34d399"
          filter="url(#glow)"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Center text */}
        <text
          x={cx}
          y={cy - 8}
          textAnchor="middle"
          className="fill-white text-4xl font-bold"
          style={{ fontSize: 40 }}
        >
          {Math.round(percentage)}%
        </text>
        <text
          x={cx}
          y={cy + 20}
          textAnchor="middle"
          className="fill-gray-400 text-sm"
          style={{ fontSize: 14 }}
        >
          Novel
        </text>
      </svg>
    </div>
  );
}
