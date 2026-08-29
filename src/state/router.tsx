/**
 * Hash router.
 *
 * Hash routing rather than history routing on purpose: the built app has to run
 * from a file path or any static host with no server rewrite rules, which is
 * what makes it installable and usable offline.
 */

import { useCallback, useEffect, useState } from 'react';

export interface Route {
  /** Path segments after the '#/', e.g. ['farmers', 'frm_001']. */
  segments: string[];
  path: string;
  query: URLSearchParams;
}

function read(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = (pathPart ?? '').split('/').filter(Boolean);
  return {
    segments,
    path: '/' + segments.join('/'),
    query: new URLSearchParams(queryPart ?? ''),
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`;
  if (opts.replace) window.location.replace(target);
  else window.location.hash = target;
  // Jump back to the top when moving between screens, the way a page load would.
  requestAnimationFrame(() => document.querySelector('.app__content')?.scrollTo({ top: 0 }));
}

export function useNavigate() {
  return useCallback(navigate, []);
}

/** An anchor that keeps middle-click and "open in new tab" working. */
export function Link({
  to,
  children,
  className,
  title,
  style,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <a
      href={`#${to.startsWith('/') ? '' : '/'}${to}`}
      className={className}
      title={title}
      style={style}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
