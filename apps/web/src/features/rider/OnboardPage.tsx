// Rider onboarding — collect vehicle + license, become a rider (kyc=pending).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ServiceType } from '@/lib/types';

const VEHICLES: Array<{ value: ServiceType; label: string; hint: string }> = [
  { value: 'bike',          label: 'Bike / Scooter',   hint: 'Bike or scooter — you\'ll get bike rides and parcel deliveries' },
  { value: 'auto',          label: 'Auto',             hint: 'Auto-rickshaw or e-rickshaw' },
  { value: 'cab_4',         label: 'Cab (4-seater)',   hint: 'Hatchback or sedan' },
  { value: 'cab_7',         label: 'Cab (7-seater)',   hint: 'SUV / Ertiga / Innova' },
  { value: 'parcel_truck',  label: 'Mini truck',       hint: 'Tata Ace, Bolero pickup — parcel only' },
];

export default function OnboardPage() {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [vehicle, setVehicle] = useState<ServiceType>('bike');
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [license, setLicense] = useState('');
  const [city, setCity] = useState(import.meta.env.VITE_DEFAULT_CITY || 'Hyderabad');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/riders/onboard', {
        vehicle_type: vehicle,
        vehicle_number: plate.toUpperCase().replace(/\s+/g, ' ').trim(),
        vehicle_model: model || undefined,
        license_number: license,
        city,
      });
      await refresh();
      nav('/captain', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-surface-muted">
      <header className="bg-surface-strong text-white px-4 py-4">
        <div className="text-xs opacity-80">Become a Captain</div>
        <div className="font-bold">Tell us about your vehicle</div>
      </header>

      <form onSubmit={submit} className="max-w-md mx-auto p-4 space-y-4">
        <div className="card space-y-3">
          <div>
            <span className="text-sm font-medium text-slate-700">Vehicle type</span>
            <div className="mt-2 space-y-2">
              {VEHICLES.map((v) => (
                <label
                  key={v.value}
                  className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition ${
                    vehicle === v.value
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/30'
                      : 'border-surface-border bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="vehicle"
                    value={v.value}
                    checked={vehicle === v.value}
                    onChange={() => setVehicle(v.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-semibold">{v.label}</div>
                    <div className="text-xs text-slate-500">{v.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="card space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Vehicle number</span>
            <input
              className="input mt-1"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="TS 09 AB 1234"
              required
              maxLength={20}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Model <span className="text-slate-400">(optional)</span></span>
            <input
              className="input mt-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Honda Activa 6G"
              maxLength={40}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Driving licence number</span>
            <input
              className="input mt-1"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              required
              minLength={3}
              maxLength={30}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">City</span>
            <input
              className="input mt-1"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              minLength={2}
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Submitting…' : 'Submit for KYC review'}
        </button>

        <p className="text-xs text-slate-500 text-center">
          An admin will review your details and approve you within a few hours.
          You can start accepting trips once approved.
        </p>
      </form>
    </div>
  );
}
