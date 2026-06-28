/**
 * Full-window startup screen shown while persisted settings/layout hydrate from
 * the main process. Pure-black so it blends seamlessly into the window's
 * background and there is no flash before the shell appears.
 */
import { Logo } from '@/renderer/components/brand/Logo';
import { Spinner } from '@/renderer/components/ui/Spinner';

export function LoadingScreen({ message = 'Starting Limboo…' }: { message?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-base text-fg">
      <Logo size={48} className="animate-pulse" />
      <div className="flex flex-col items-center gap-3">
        <Spinner size={18} />
        <span className="text-[13px] font-medium tracking-tight text-muted">{message}</span>
      </div>
    </div>
  );
}
