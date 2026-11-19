const { scrapeTasse } = require('./tasse');
const { scrapeCalendarioAppelli } = require('./prenotazioni');

// Some ESIS nodes reject a new tab even though the original career page is
// authenticated. Retry failed reads once on that original tab, sequentially.
async function readSlowData(context, page, esisUrl, dependencies = {}) {
  const readTaxes = dependencies.scrapeTasse || scrapeTasse;
  const readAppelli = dependencies.scrapeCalendarioAppelli || scrapeCalendarioAppelli;
  const attempt = async (kind, options) => {
    try {
      const value = await (kind === 'taxes' ? readTaxes : readAppelli)(context, esisUrl, options);
      if (kind === 'taxes' && (!value || value.available === false)) {
        return { status: 'error', error: value?.reason || 'TAXES_DATA_NOT_AVAILABLE' };
      }
      if (kind === 'appelli' && !Array.isArray(value)) return { status: 'error', error: 'APPELLI_DATA_NOT_AVAILABLE' };
      return { status: 'ready', value };
    } catch (error) {
      return { status: 'error', error: error?.code || (kind === 'taxes' ? 'TAXES_DATA_NOT_AVAILABLE' : 'APPELLI_DATA_NOT_AVAILABLE') };
    }
  };
  let [taxes, appelli] = await Promise.all([attempt('taxes'), attempt('appelli')]);
  if (taxes.status === 'error') taxes = await attempt('taxes', { page });
  if (appelli.status === 'error') appelli = await attempt('appelli', { page });
  const section = result => result.status === 'ready' ? { status: 'ready' } : { status: 'error', error: result.error };
  return {
    tasse: taxes.status === 'ready' ? taxes.value : null,
    prenotazioni: appelli.status === 'ready' ? appelli.value : [],
    slowSections: { taxes: section(taxes), appelli: section(appelli) }
  };
}

module.exports = { readSlowData };
