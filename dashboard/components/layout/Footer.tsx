import { ExternalLink } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="py-6 sm:py-8 px-3 text-center border-t border-white/10">
      <p className="text-gray-500 text-sm mb-3">
        DEEPMINE - Mining Earth's Microbiome for New Antibiotics
      </p>
      <div className="flex items-center justify-center gap-6">
        <a
          href="https://github.com/deepmine"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors text-xs"
        >
          GitHub
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href="https://deepmine.org/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors text-xs"
        >
          Documentation
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </footer>
  );
}
