/** About — read-only runtime/version metadata from the main process. */
import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { Section, Meta } from '../controls';

export function AboutPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.limboo?.app.getInfo().then(setInfo);
  }, []);

  return (
    <Section title="About Limboo" hint="The operating environment for AI software development.">
      {info ? (
        <dl className="flex flex-col">
          <Meta label="Version" value={info.version} />
          <Meta label="Electron" value={info.electron} />
          <Meta label="Chromium" value={info.chrome} />
          <Meta label="Node" value={info.node} />
          <Meta label="Platform" value={info.platform} />
        </dl>
      ) : (
        <p className="px-2 py-2 text-[12px] text-faint">Loading…</p>
      )}
    </Section>
  );
}
