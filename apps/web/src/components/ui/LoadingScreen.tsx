// Shared loading state — animated GoRide logo, used everywhere we wait on
// an initial API call so the app feels branded, not blank.
interface Props {
  label?: string;
}

export default function LoadingScreen({ label = 'Loading…' }: Props) {
  return (
    <div className="h-full grid place-items-center bg-white">
      <div className="text-center">
        <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-brand-500 grid place-items-center animate-pulse">
          <span className="font-bold text-2xl text-surface-strong">Go</span>
        </div>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}
