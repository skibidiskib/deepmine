'use client';

import { useState, useRef, useEffect } from 'react';
import { Dna, ExternalLink, Download, User, LogOut } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import LiveIndicator from '@/components/ui/LiveIndicator';

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load saved user from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('deepmine_user');
    if (saved) setLoggedInUser(saved);
  }, []);

  // Pre-fill username from URL if on a user profile page
  const pageUsername = pathname?.startsWith('/user/') ? pathname.split('/')[2] : null;
  useEffect(() => {
    if (pageUsername && !loggedInUser && !username) {
      setUsername(pageUsername);
    }
  }, [pageUsername, loggedInUser]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLogin(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogin = async () => {
    if (!username.trim()) { setError('Enter your username'); return; }
    if (!pin.trim()) { setError('Enter your 6-digit PIN'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), pin: pin.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('deepmine_user', username.trim());
        setLoggedInUser(username.trim());
        setShowLogin(false);
        setUsername('');
        setPin('');
        router.push(`/user/${username.trim()}`);
      } else {
        setError(data.error || 'Invalid username or PIN');
      }
    } catch {
      setError('Connection failed');
    }
    setLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('deepmine_user');
    setLoggedInUser(null);
    setShowLogin(false);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between bg-slate-950/80 backdrop-blur-md border-b border-white/10">
      <div className="flex items-center gap-2 sm:gap-3">
        <Dna className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-400" />
        <div className="flex items-baseline gap-1.5 sm:gap-2">
          <span className="text-base sm:text-lg font-bold bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">
            DEEPMINE
          </span>
          <span className="text-xs sm:text-sm text-gray-400 hidden sm:inline">
            Community Dashboard
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <LiveIndicator />

        {/* User login/profile */}
        <div className="relative" ref={dropdownRef}>
          {loggedInUser ? (
            <button
              onClick={() => setShowLogin(!showLogin)}
              className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors text-sm"
            >
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">{loggedInUser}</span>
            </button>
          ) : (
            <button
              onClick={() => setShowLogin(!showLogin)}
              className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Login</span>
            </button>
          )}

          {/* Dropdown */}
          {showLogin && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-slate-900 border border-white/10 shadow-xl p-4 z-50">
              {loggedInUser ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-sm font-bold">
                      {loggedInUser.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm text-white font-medium">{loggedInUser}</div>
                      <div className="text-xs text-gray-500">Logged in</div>
                    </div>
                  </div>
                  <a
                    href={`/user/${loggedInUser}`}
                    className="block w-full text-left px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/5 transition-colors mb-1"
                  >
                    My Profile
                  </a>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-white/5 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Log out
                  </button>
                </>
              ) : (
                <>
                  <div className="text-sm text-white font-medium mb-3">
                    {pageUsername ? `Sign in as ${pageUsername}` : 'Sign in to your miner'}
                  </div>
                  {pageUsername ? (
                    <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-white/5 border border-white/10">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-[10px] font-bold">
                        {pageUsername.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-white">{pageUsername}</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="Username (e.g. azure.lagoon)"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && document.getElementById('pin-input')?.focus()}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none mb-2"
                      autoFocus
                    />
                  )}
                  <input
                    id="pin-input"
                    type="password"
                    placeholder="6-digit PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none mb-2"
                    inputMode="numeric"
                  />
                  {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
                  <button
                    onClick={handleLogin}
                    disabled={loading}
                    className="w-full py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Sign in'}
                  </button>
                  <details className="mt-2">
                    <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-400">Forgot PIN?</summary>
                    <div className="mt-1.5">
                      <p className="text-[11px] text-gray-600 mb-1.5">Run this in your terminal:</p>
                      <div
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-black/30 border border-white/10 cursor-pointer hover:border-white/20 transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText('npx deepmine pin');
                          const el = document.getElementById('pin-copy-msg');
                          if (el) { el.textContent = 'Copied!'; setTimeout(() => { el.textContent = 'Click to copy'; }, 1500); }
                        }}
                      >
                        <code className="text-[11px] text-emerald-400 font-mono">npx deepmine pin</code>
                        <span id="pin-copy-msg" className="text-[10px] text-gray-600">Click to copy</span>
                      </div>
                    </div>
                  </details>
                </>
              )}
            </div>
          )}
        </div>

        <a
          href="/discoveries"
          className="flex items-center gap-1.5 text-gray-400 hover:text-emerald-400 transition-colors text-sm"
        >
          <span className="hidden sm:inline">Discoveries</span>
          <Download className="w-4 h-4" />
        </a>
        <a
          href="https://github.com/skibidiskib/deepmine"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <span className="hidden sm:inline">GitHub</span>
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
}
