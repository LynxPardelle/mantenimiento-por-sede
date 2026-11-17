import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

const initialState: { status: 'idle' | 'checking' | 'ready' | 'unavailable' } = {
  status: 'idle',
};

export const HealthStore = signalStore(
  withState(initialState),
  withMethods((store, http = inject(HttpClient)) => ({
    async refresh(): Promise<void> {
      if (store.status() === 'checking') {
        return;
      }

      patchState(store, { status: 'checking' });

      try {
        const result = await firstValueFrom(
          http.get<{ status: string }>('/api/health', { timeout: 5000 }),
        );
        patchState(store, { status: result?.status === 'ok' ? 'ready' : 'unavailable' });
      } catch {
        patchState(store, { status: 'unavailable' });
      }
    },
  })),
);
