import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
  Asset,
  AssetInput,
  Completion,
  Inspection,
  Page,
  Site,
  siteToday,
} from './maintenance.models';

interface State {
  sites: Site[];
  site: Site | undefined;
  assets: Asset[];
  pending: Inspection[];
  history: Inspection[];
  historyAssetId: string;
  assetsNextToken: string;
  pendingNextToken: string;
  historyNextToken: string;
  dueThrough: string;
  loading: boolean;
  saving: boolean;
  historyLoading: boolean;
  error: string;
  notice: string;
}
const initialState: State = {
  sites: [],
  site: undefined,
  assets: [],
  pending: [],
  history: [],
  historyAssetId: '',
  assetsNextToken: '',
  pendingNextToken: '',
  historyNextToken: '',
  dueThrough: '',
  loading: false,
  saving: false,
  historyLoading: false,
  error: '',
  notice: '',
};

export const MaintenanceStore = signalStore(
  withState(initialState),
  withMethods((store, http = inject(HttpClient)) => {
    let generation = 0;
    let readGeneration = 0;
    let historyGeneration = 0;
    const idempotency = new Map<string, { signature: string; key: string }>();
    const base = (site: Site) => `/api/v1/sites/${encodeURIComponent(site.id)}`;
    const options = { timeout: 15000, transferCache: false };
    const keyFor = (operation: string, payload: unknown) => {
      const signature = JSON.stringify(payload);
      const previous = idempotency.get(operation);
      if (previous?.signature === signature) return previous.key;
      const key = crypto.randomUUID();
      idempotency.set(operation, { signature, key });
      return key;
    };

    async function refresh(appendAssets = false, appendPending = false): Promise<void> {
      const site = store.site();
      if (!site) return;
      const current = generation;
      const read = ++readGeneration;
      patchState(store, { loading: true, error: '' });
      const assetParams =
        appendAssets && store.assetsNextToken()
          ? new HttpParams().set('nextToken', store.assetsNextToken())
          : new HttpParams();
      let pendingParams = new HttpParams()
        .set('status', 'pending')
        .set('dueThrough', store.dueThrough());
      if (appendPending && store.pendingNextToken())
        pendingParams = pendingParams.set('nextToken', store.pendingNextToken());
      try {
        const [assets, pending] = await Promise.all([
          appendPending
            ? Promise.resolve(undefined)
            : firstValueFrom(
                http.get<Page<Asset>>(`${base(site)}/assets`, { ...options, params: assetParams }),
              ),
          appendAssets
            ? Promise.resolve(undefined)
            : firstValueFrom(
                http.get<Page<Inspection>>(`${base(site)}/inspections`, {
                  ...options,
                  params: pendingParams,
                }),
              ),
        ]);
        if (current !== generation || read !== readGeneration) return;
        patchState(store, {
          ...(assets
            ? {
                assets: appendAssets
                  ? uniqueById([...store.assets(), ...assets.items])
                  : assets.items,
                assetsNextToken: assets.nextToken || '',
              }
            : {}),
          ...(pending
            ? {
                pending: appendPending
                  ? uniqueById([...store.pending(), ...pending.items])
                  : pending.items,
                pendingNextToken: pending.nextToken || '',
              }
            : {}),
        });
      } catch (error) {
        if (current === generation && read === readGeneration)
          patchState(store, { error: errorMessage(error) });
      } finally {
        if (current === generation && read === readGeneration)
          patchState(store, { loading: false });
      }
    }

    async function loadHistory(assetId: string, append = false): Promise<void> {
      const site = store.site();
      if (!site || !assetId) return;
      const current = generation;
      const historyRequest = ++historyGeneration;
      const token = append && store.historyAssetId() === assetId ? store.historyNextToken() : '';
      patchState(store, {
        historyAssetId: assetId,
        historyLoading: true,
        ...(append ? {} : { history: [], historyNextToken: '' }),
      });
      try {
        const history = await firstValueFrom(
          http.get<Page<Inspection>>(
            `${base(site)}/assets/${encodeURIComponent(assetId)}/inspections`,
            { ...options, params: token ? { nextToken: token } : {} },
          ),
        );
        if (current === generation && historyRequest === historyGeneration)
          patchState(store, {
            history: append ? uniqueById([...store.history(), ...history.items]) : history.items,
            historyNextToken: history.nextToken || '',
          });
      } catch (error) {
        if (current === generation && historyRequest === historyGeneration)
          patchState(store, { error: errorMessage(error) });
      } finally {
        if (current === generation && historyRequest === historyGeneration)
          patchState(store, { historyLoading: false });
      }
    }

    return {
      async loadSites(): Promise<void> {
        patchState(store, { loading: true, error: '' });
        try {
          const sites = await firstValueFrom(http.get<Page<Site>>('/api/v1/sites', options));
          patchState(store, { sites: sites.items });
        } catch (error) {
          patchState(store, { error: errorMessage(error) });
        } finally {
          patchState(store, { loading: false });
        }
      },
      async selectSite(site: Site): Promise<void> {
        generation++;
        historyGeneration++;
        patchState(store, {
          ...initialState,
          sites: store.sites(),
          site,
          dueThrough: siteToday(site.timeZone),
        });
        await refresh();
      },
      refresh,
      loadHistory,
      async filterPending(dueThrough: string): Promise<void> {
        if (store.saving() || !/^\d{4}-\d{2}-\d{2}$/.test(dueThrough)) return;
        patchState(store, { dueThrough, pending: [], pendingNextToken: '', notice: '' });
        await refresh();
      },
      async createAsset(payload: AssetInput): Promise<boolean> {
        const site = store.site();
        if (!site || store.saving() || site.role !== 'coordinator') return false;
        const current = generation;
        const operation = `${site.id}/asset`;
        patchState(store, { saving: true, error: '', notice: '' });
        try {
          const asset = await firstValueFrom(
            http.post<Asset>(`${base(site)}/assets`, payload, {
              ...options,
              headers: { 'Idempotency-Key': keyFor(operation, payload) },
            }),
          );
          idempotency.delete(operation);
          if (current !== generation) return false;
          patchState(store, {
            assets: uniqueById([asset, ...store.assets()]),
            notice: 'Equipo registrado. Ya puedes programar su primera inspección.',
          });
          return true;
        } catch (error) {
          if (current === generation) patchState(store, { error: errorMessage(error) });
          return false;
        } finally {
          if (current === generation) patchState(store, { saving: false });
        }
      },
      async scheduleInspection(assetId: string, dueDate: string): Promise<boolean> {
        const site = store.site();
        if (!site || store.saving() || site.role !== 'coordinator') return false;
        const current = generation;
        const operation = `${site.id}/${assetId}/schedule`;
        const payload = { dueDate };
        patchState(store, { saving: true, error: '', notice: '' });
        try {
          const inspection = await firstValueFrom(
            http.post<Inspection>(
              `${base(site)}/assets/${encodeURIComponent(assetId)}/inspections`,
              payload,
              { ...options, headers: { 'Idempotency-Key': keyFor(operation, payload) } },
            ),
          );
          idempotency.delete(operation);
          if (current !== generation) return false;
          patchState(store, {
            pending:
              dueDate <= store.dueThrough()
                ? uniqueById([inspection, ...store.pending()])
                : store.pending(),
            notice: `Inspección programada para ${dueDate}.`,
          });
          await loadHistory(assetId);
          return true;
        } catch (error) {
          if (current === generation) patchState(store, { error: errorMessage(error) });
          return false;
        } finally {
          if (current === generation) patchState(store, { saving: false });
        }
      },
      async completeInspection(inspection: Inspection, payload: Completion): Promise<boolean> {
        const site = store.site();
        if (!site || store.saving()) return false;
        const current = generation;
        patchState(store, { saving: true, error: '', notice: '' });
        try {
          await firstValueFrom(
            http.put<Inspection>(
              `${base(site)}/assets/${encodeURIComponent(inspection.assetId)}/inspections/${encodeURIComponent(inspection.id)}/completion`,
              payload,
              options,
            ),
          );
          if (current !== generation) return false;
          patchState(store, {
            pending: store.pending().filter((item) => item.id !== inspection.id),
            notice:
              'Inspección completada. El historial se consulta de nuevo para confirmar el registro.',
          });
          await loadHistory(inspection.assetId);
          return true;
        } catch (error) {
          if (current === generation) patchState(store, { error: errorMessage(error) });
          return false;
        } finally {
          if (current === generation) patchState(store, { saving: false });
        }
      },
    };
  }),
);

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Tu sesión venció. Sal e inicia sesión de nuevo.';
    if (error.status === 403) return 'Tu rol no permite realizar esta acción.';
    if (error.status === 404) return 'La sede o el registro ya no está disponible para tu cuenta.';
    if (error.status === 409)
      return 'El registro cambió o esta operación ya se completó con otros datos. Actualiza el historial antes de continuar.';
    if (error.status === 400) return 'Revisa los datos e inténtalo de nuevo.';
  }
  return 'No se pudo guardar o consultar la información. Los datos del formulario se conservaron; puedes volver a intentarlo.';
}
