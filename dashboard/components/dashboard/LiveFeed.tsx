'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import GlassCard from '@/components/ui/GlassCard';
import LiveIndicator from '@/components/ui/LiveIndicator';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDate, getBGCTypeColor } from '@/lib/utils';

interface FeedEvent {
  id: string;
  type: string;
  username: string;
  bgc_type: string;
  activity_score: number;
  source_sample: string;
  discovered_at: string;
}

export default function LiveFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource('/api/sse');

    es.onopen = () => setConnected(true);

    es.addEventListener('new_discovery', (e) => {
      try {
        const data = JSON.parse(e.data) as FeedEvent;
        setEvents((prev) => {
          const next = [{ ...data, id: data.id || crypto.randomUUID() }, ...prev];
          return next.slice(0, 20);
        });
      } catch {
        // Ignore malformed events
      }
    });

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events]);

  return (
    <GlassCard hover={false}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">
          Live Discovery Feed
        </h2>
        <LiveIndicator />
      </div>

      <div
        ref={scrollRef}
        className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10"
      >
        <AnimatePresence initial={false}>
          {events.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-center py-12 text-gray-500 text-sm"
            >
              Waiting for discoveries...
            </motion.div>
          ) : (
            events.map((event) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.3 }}
                className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              >
                <span className="text-xs text-gray-500 shrink-0">
                  {formatDate(event.discovered_at)}
                </span>

                <span className="text-xs font-semibold text-emerald-400 truncate max-w-[80px] sm:max-w-[100px]">
                  {event.username}
                </span>

                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: getBGCTypeColor(event.bgc_type) + '20',
                    color: getBGCTypeColor(event.bgc_type),
                  }}
                >
                  {event.bgc_type}
                </span>

                <StatusBadge score={event.activity_score} />

                <span className="text-xs text-gray-500 truncate ml-auto hidden sm:inline">
                  {event.source_sample}
                </span>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </GlassCard>
  );
}
