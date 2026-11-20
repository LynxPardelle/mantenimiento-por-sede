import { fail, guarded, internalRequest, response } from './common.mjs';

export function createPilotExportHandler({ repository }) {
  return guarded(async event => {
    if (!internalRequest(event, 'exportPilotRegistry') || Object.keys(event).some(key => key !== 'internalAction')) fail(404, 'not_found');
    return response(200, await repository.exportRegistry());
  });
}

let production;
export async function handler(event) {
  production ??= import('./pilot-repository.mjs').then(({ createPilotRepository }) => createPilotExportHandler({ repository: createPilotRepository() }));
  return (await production)(event);
}
