import { DatePipe } from '@angular/common';
import { Component, afterNextRender, inject, signal } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { MaintenanceStore } from './maintenance.store';
import { AssetInput, Completion, Inspection, displayLocalDate } from './maintenance.models';

@Component({
  selector: 'app-maintenance',
  imports: [RouterLink, FormField, DatePipe],
  providers: [MaintenanceStore],
  templateUrl: './maintenance.page.html',
  styleUrl: './maintenance.page.css',
})
export class MaintenancePage {
  readonly auth = inject(AuthService);
  readonly store = inject(MaintenanceStore);
  readonly localDate = displayLocalDate;
  readonly assetModel = signal<AssetInput>({ name: '', type: '', status: 'operational' });
  readonly assetForm = form(this.assetModel, (path) => {
    required(path.name);
    maxLength(path.name, 120);
    required(path.type);
    maxLength(path.type, 80);
  });
  readonly scheduleModel = signal({ assetId: '', dueDate: '' });
  readonly scheduleForm = form(this.scheduleModel, (path) => {
    required(path.assetId);
    required(path.dueDate);
  });
  readonly completionModel = signal<Completion>({ result: 'ok', note: '' });
  readonly completionForm = form(this.completionModel, (path) => {
    required(path.result);
    required(path.note);
    maxLength(path.note, 2000);
  });
  readonly closing = signal<Inspection | undefined>(undefined);
  readonly showAssetForm = signal(false);
  readonly activeTab = signal<'pending' | 'assets' | 'history'>('pending');
  constructor() {
    afterNextRender(() => {
      void this.initialize();
    });
  }
  async initialize(): Promise<void> {
    await this.store.loadSites();
    const first = this.store.sites()[0];
    if (first && !this.store.site()) {
      await this.store.selectSite(first);
      this.scheduleModel.update((model) => ({ ...model, dueDate: this.store.dueThrough() }));
    }
  }
  async changeSite(event: Event): Promise<void> {
    const id = (event.target as HTMLSelectElement).value;
    const site = this.store.sites().find((item) => item.id === id);
    if (!site) return;
    this.closing.set(undefined);
    this.showAssetForm.set(false);
    this.assetModel.set({ name: '', type: '', status: 'operational' });
    this.completionModel.set({ result: 'ok', note: '' });
    await this.store.selectSite(site);
    this.scheduleModel.set({ assetId: '', dueDate: this.store.dueThrough() });
  }
  async createAsset(event: Event): Promise<void> {
    event.preventDefault();
    if (this.assetForm().invalid()) return;
    const raw = this.assetModel();
    if (await this.store.createAsset({ ...raw, name: raw.name.trim(), type: raw.type.trim() })) {
      this.assetModel.set({ name: '', type: '', status: 'operational' });
      this.showAssetForm.set(false);
      this.scheduleModel.update((model) => ({
        ...model,
        assetId: this.store.assets()[0]?.id || '',
      }));
    }
  }
  async schedule(event: Event): Promise<void> {
    event.preventDefault();
    if (this.scheduleForm().invalid()) return;
    const model = this.scheduleModel();
    await this.store.scheduleInspection(model.assetId, model.dueDate);
  }
  async complete(event: Event): Promise<void> {
    event.preventDefault();
    const inspection = this.closing();
    if (!inspection || this.completionForm().invalid()) return;
    if (
      await this.store.completeInspection(inspection, {
        ...this.completionModel(),
        note: this.completionModel().note.trim(),
      })
    ) {
      this.closing.set(undefined);
      this.completionModel.set({ result: 'ok', note: '' });
      this.activeTab.set('history');
    }
  }
  startCompletion(inspection: Inspection): void {
    this.closing.set(inspection);
    this.completionModel.set({ result: 'ok', note: '' });
  }
  assetName(id: string): string {
    return this.store.assets().find((asset) => asset.id === id)?.name || id;
  }
  async viewHistory(assetId: string): Promise<void> {
    this.activeTab.set('history');
    await this.store.loadHistory(assetId);
  }
  async changeHistoryAsset(event: Event): Promise<void> {
    await this.store.loadHistory((event.target as HTMLSelectElement).value);
  }
  async changeDueThrough(event: Event): Promise<void> {
    await this.store.filterPending((event.target as HTMLInputElement).value);
  }
  resultLabel(result?: string): string {
    return (
      (
        { ok: 'En orden', attention: 'Requiere atención', failed: 'Falla detectada' } as Record<
          string,
          string
        >
      )[result || ''] || 'Sin resultado'
    );
  }
}
