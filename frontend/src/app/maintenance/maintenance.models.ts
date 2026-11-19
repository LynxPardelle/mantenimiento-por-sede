export interface Site {
  id: string;
  name: string;
  timeZone: string;
  role: 'coordinator' | 'technician';
}
export interface Asset {
  id: string;
  name: string;
  type: string;
  status: 'operational' | 'out_of_service';
}
export interface Inspection {
  id: string;
  assetId: string;
  dueDate: string;
  status: 'pending' | 'completed';
  result?: 'ok' | 'attention' | 'failed';
  note?: string;
  completedAt?: string;
  completedBy?: string;
}
export interface Page<T> {
  items: T[];
  nextToken?: string;
}
export type AssetInput = Omit<Asset, 'id'>;
export interface Completion {
  result: 'ok' | 'attention' | 'failed';
  note: string;
}

export function siteToday(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function displayLocalDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}
