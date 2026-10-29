'use client';

import { useEffect, useState } from 'react';
import { SIPAccount, SIPTrunk } from '@/types/telephony';
import { telephonyApi } from '@/lib/telephony-api-client';
import { useLanguage } from '@/lib/language';

interface EditingItem {
  type: 'account' | 'trunk';
  id?: string;
}

export default function TelephonyPage() {
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState<SIPAccount[]>([]);
  const [trunks, setTrunks] = useState<SIPTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [copiedTrunkId, setCopiedTrunkId] = useState<string | null>(null);

  const [accountForm, setAccountForm] = useState<Partial<SIPAccount>>({
    name: '',
    extension: '',
    secret: '',
    account_type: 'local',
    caller_id: '',
    host: '',
    transport: 'udp',
    context: 'from-internal',
    codecs: 'ulaw,alaw',
    enabled: true,
  });

  const [trunkForm, setTrunkForm] = useState<Partial<SIPTrunk>>({
    name: '',
    trunk_type: 'gsm_gateway',
    host: '',
    port: 5060,
    username: '',
    secret: '',
    from_user: '',
    from_domain: '',
    inbound_context: 'from-trunk',
    outbound_prefix: '',
    codecs: 'ulaw,alaw',
    dial_format: 'local',
    enabled: true,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [accountsData, trunksData] = await Promise.all([
        telephonyApi.getSIPAccounts(),
        telephonyApi.getSIPTrunks(),
      ]);
      setAccounts(accountsData);
      setTrunks(trunksData);
      setError(null);
    } catch (err) {
      setError(t('telephony.loadError'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleEditAccount = (account: SIPAccount) => {
    setAccountForm(account);
    setEditing({ type: 'account', id: account.id });
  };

  const handleEditTrunk = (trunk: SIPTrunk) => {
    setTrunkForm(trunk);
    setEditing({ type: 'trunk', id: trunk.id });
  };

  const handleSaveAccount = async () => {
    try {
      if (editing?.id) {
        await telephonyApi.updateSIPAccount(editing.id, accountForm);
        setSuccess(t('telephony.accountUpdated'));
      } else {
        await telephonyApi.createSIPAccount(accountForm as Omit<SIPAccount, 'id' | 'created_at' | 'updated_at'>);
        setSuccess(t('telephony.accountCreated'));
      }
      setEditing(null);
      setAccountForm({ name: '', extension: '', secret: '', account_type: 'local', caller_id: '', host: '', transport: 'udp', context: 'from-internal', codecs: 'ulaw,alaw', enabled: true });
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(t('telephony.accountSaveError'));
      console.error(err);
    }
  };

  const handleSaveTrunk = async () => {
    try {
      if (editing?.id) {
        await telephonyApi.updateSIPTrunk(editing.id, trunkForm);
        setSuccess(t('telephony.trunkUpdated'));
      } else {
        await telephonyApi.createSIPTrunk(trunkForm as Omit<SIPTrunk, 'id' | 'created_at' | 'updated_at'>);
        setSuccess(t('telephony.trunkCreated'));
      }
      setEditing(null);
      setTrunkForm({ name: '', trunk_type: 'gsm_gateway', host: '', port: 5060, username: '', secret: '', from_user: '', from_domain: '', inbound_context: 'from-trunk', outbound_prefix: '', codecs: 'ulaw,alaw', dial_format: 'local', enabled: true });
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(t('telephony.trunkSaveError'));
      console.error(err);
    }
  };

  // Trunks are pinned by id (not name) via the external call-trigger API's trunkId field
  // (a uuid — see routes/external-calls.ts), so ops needs to hand that exact value to
  // integration partners, not just eyeball it.
  const copyTrunkId = async (trunkId: string) => {
    try {
      await navigator.clipboard.writeText(trunkId);
      setCopiedTrunkId(trunkId);
      setTimeout(() => setCopiedTrunkId((current) => (current === trunkId ? null : current)), 2000);
    } catch {
      // clipboard API unavailable — the id is still visible to select/copy manually
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">{t('telephony.heading')}</h1>
        <button
          onClick={async () => {
            try {
              setError(null);
              setSuccess(null);
              await telephonyApi.render();
              setSuccess(t('telephony.generateSuccess'));
              setTimeout(() => setSuccess(null), 3000);
            } catch (err) {
              setError(t('telephony.generateError'));
              console.error(err);
            }
          }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded font-medium"
        >
          🔄 {t('telephony.generateReload')}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/20 border border-red-500 rounded text-red-300">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-500/20 border border-green-500 rounded text-green-300">
          {success}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400">{t('telephony.loading')}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* SIP Accounts */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-white">{t('telephony.sipAccounts')} ({accounts.length})</h2>
              <button
                onClick={() => {
                  setAccountForm({ name: '', extension: '', secret: '', account_type: 'local', caller_id: '', host: '', transport: 'udp', context: 'from-internal', codecs: 'ulaw,alaw', enabled: true });
                  setEditing({ type: 'account' });
                }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
              >
                {t('telephony.add')}
              </button>
            </div>

            {editing?.type === 'account' && (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 mb-6">
                <h3 className="text-lg font-semibold text-white mb-4">{editing.id ? t('telephony.edit') : t('telephony.create')} {t('telephony.sipAccount')}</h3>
                <div className="space-y-4">
                  <input
                    type="text"
                    placeholder={t('telephony.namePlaceholder')}
                    value={accountForm.name || ''}
                    onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.extensionPlaceholder')}
                    value={accountForm.extension || ''}
                    onChange={(e) => setAccountForm({ ...accountForm, extension: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="password"
                    placeholder={t('telephony.passwordPlaceholder')}
                    value={accountForm.secret || ''}
                    onChange={(e) => setAccountForm({ ...accountForm, secret: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <select
                    value={accountForm.account_type || 'local'}
                    onChange={(e) => setAccountForm({ ...accountForm, account_type: e.target.value as "local" | "public" })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  >
                    <option value="">{t('telephony.typeOption')}</option>
                    <option value="local">local</option>
                    <option value="public">public</option>
                  </select>
                  <input
                    type="text"
                    placeholder={t('telephony.callerIdPlaceholder')}
                    value={accountForm.caller_id || ''}
                    onChange={(e) => setAccountForm({ ...accountForm, caller_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.hostPlaceholder')}
                    value={accountForm.host || ''}
                    onChange={(e) => setAccountForm({ ...accountForm, host: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <select
                    value={accountForm.transport || 'udp'}
                    onChange={(e) => setAccountForm({ ...accountForm, transport: e.target.value as "udp" | "tcp" | "tls" })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  >
                    <option value="udp">{t('telephony.transportUdp')}</option>
                    <option value="tcp">{t('telephony.transportTcp')}</option>
                    <option value="tls">{t('telephony.transportTls')}</option>
                  </select>
                  <input
                    type="text"
                    placeholder={t('telephony.contextPlaceholder')}
                    value={accountForm.context || ''}
                    onChange={(e) => setAccountForm({ ...accountForm, context: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.codecsPlaceholder')}
                    value={accountForm.codecs || ''}
                    onChange={(e) => setAccountForm({ ...accountForm, codecs: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <label className="flex items-center text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={accountForm.enabled || false}
                      onChange={(e) => setAccountForm({ ...accountForm, enabled: e.target.checked })}
                      className="mr-2"
                    />
                    {t('telephony.enabled')}
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveAccount}
                      className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                    >
                      {t('telephony.save')}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
                    >
                      {t('telephony.cancel')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {accounts.length === 0 ? (
                <p className="text-gray-400 text-sm">{t('telephony.noAccounts')}</p>
              ) : (
                accounts.map((account) => (
                  <div key={account.id} className="bg-slate-800 rounded p-3 text-sm border border-slate-700">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-semibold text-white">{account.name} ({account.extension})</div>
                        <div className="text-gray-400 text-xs space-y-1 mt-2">
                          <div>{t('telephony.type')} <span className="text-white">{account.account_type}</span></div>
                          <div>{t('telephony.callerId')} <span className="text-white">{account.caller_id || '-'}</span></div>
                          <div>{t('telephony.host')} <span className="text-white">{account.host || 'dynamic'}</span></div>
                          <div>{t('telephony.transport')} <span className="text-white">{account.transport || 'udp'}</span></div>
                          <div>{t('telephony.context')} <span className="text-white">{account.context || 'from-internal'}</span></div>
                          <div>{t('telephony.codecs')} <span className="text-white">{account.codecs || 'ulaw,alaw'}</span></div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditAccount(account)}
                          className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-xs"
                        >
                          {t('telephony.edit')}
                        </button>
                        <div className={`px-2 py-1 rounded text-xs font-semibold ${
                          account.enabled ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                        }`}>
                          {account.enabled ? t('telephony.enabled') : t('telephony.disabled')}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* SIP Trunks */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-white">{t('telephony.sipTrunks')} ({trunks.length})</h2>
              <button
                onClick={() => {
                  setTrunkForm({ name: '', trunk_type: 'gsm_gateway', host: '', port: 5060, username: '', secret: '', from_user: '', from_domain: '', inbound_context: 'from-trunk', outbound_prefix: '', codecs: 'ulaw,alaw', dial_format: 'local', enabled: true });
                  setEditing({ type: 'trunk' });
                }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
              >
                {t('telephony.add')}
              </button>
            </div>

            {editing?.type === 'trunk' && (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 mb-6">
                <h3 className="text-lg font-semibold text-white mb-4">{editing.id ? t('telephony.edit') : t('telephony.create')} {t('telephony.sipTrunk')}</h3>
                <div className="space-y-4">
                  <input
                    type="text"
                    placeholder={t('telephony.namePlaceholder')}
                    value={trunkForm.name || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <select
                    value={trunkForm.trunk_type || 'gsm_gateway'}
                    onChange={(e) => setTrunkForm({ ...trunkForm, trunk_type: e.target.value as "gsm_gateway" | "provider" | "peer" })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  >
                    <option value="gsm_gateway">{t('telephony.trunkTypeGsm')}</option>
                    <option value="provider">{t('telephony.trunkTypeProvider')}</option>
                    <option value="peer">{t('telephony.trunkTypePeer')}</option>
                  </select>
                  <input
                    type="text"
                    placeholder={t('telephony.hostIpPlaceholder')}
                    value={trunkForm.host || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, host: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="number"
                    placeholder={t('telephony.portPlaceholder')}
                    value={trunkForm.port || 5060}
                    onChange={(e) => setTrunkForm({ ...trunkForm, port: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.usernamePlaceholder')}
                    value={trunkForm.username || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, username: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="password"
                    placeholder={t('telephony.secretPlaceholder')}
                    value={trunkForm.secret || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, secret: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.fromUserPlaceholder')}
                    value={trunkForm.from_user || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, from_user: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.fromDomainPlaceholder')}
                    value={trunkForm.from_domain || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, from_domain: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.inboundContextPlaceholder')}
                    value={trunkForm.inbound_context || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, inbound_context: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.outboundPrefixPlaceholder')}
                    value={trunkForm.outbound_prefix || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, outbound_prefix: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    placeholder={t('telephony.codecsPlaceholder')}
                    value={trunkForm.codecs || ''}
                    onChange={(e) => setTrunkForm({ ...trunkForm, codecs: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  />
                  <select
                    value={trunkForm.dial_format || 'local'}
                    onChange={(e) => setTrunkForm({ ...trunkForm, dial_format: e.target.value as 'local' | 'intl' })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  >
                    <option value="local">{t('telephony.dialFormatLocal')}</option>
                    <option value="intl">{t('telephony.dialFormatIntl')}</option>
                  </select>
                  <label className="flex items-center text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={trunkForm.enabled || false}
                      onChange={(e) => setTrunkForm({ ...trunkForm, enabled: e.target.checked })}
                      className="mr-2"
                    />
                    {t('telephony.enabled')}
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveTrunk}
                      className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                    >
                      {t('telephony.save')}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
                    >
                      {t('telephony.cancel')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {trunks.length === 0 ? (
                <p className="text-gray-400 text-sm">{t('telephony.noTrunks')}</p>
              ) : (
                trunks.map((trunk) => (
                  <div key={trunk.id} className="bg-slate-800 rounded p-3 text-sm border border-slate-700">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-semibold text-white">{trunk.name} ({trunk.host}:{trunk.port})</div>
                        <div className="text-gray-400 text-xs space-y-1 mt-2">
                          <div className="flex items-center gap-2">
                            <span>{t('telephony.trunkId')} <span className="text-white font-mono">{trunk.id}</span></span>
                            <button
                              onClick={() => copyTrunkId(trunk.id)}
                              className="px-1.5 py-0.5 rounded border border-slate-600 text-gray-300 hover:bg-slate-700 shrink-0"
                            >
                              {copiedTrunkId === trunk.id ? t('telephony.copied') : t('telephony.copy')}
                            </button>
                          </div>
                          <div>{t('telephony.type')} <span className="text-white">{trunk.trunk_type}</span></div>
                          <div>{t('telephony.username')} <span className="text-white">{trunk.username || '-'}</span></div>
                          <div>{t('telephony.fromUser')} <span className="text-white">{trunk.from_user || '-'}</span></div>
                          <div>{t('telephony.fromDomain')} <span className="text-white">{trunk.from_domain || '-'}</span></div>
                          <div>{t('telephony.inboundContext')} <span className="text-white">{trunk.inbound_context || 'from-trunk'}</span></div>
                          <div>{t('telephony.outboundPrefix')} <span className="text-white">{trunk.outbound_prefix || '-'}</span></div>
                          <div>{t('telephony.codecs')} <span className="text-white">{trunk.codecs || 'ulaw,alaw'}</span></div>
                          <div>{t('telephony.dialFormat')} <span className="text-white">{trunk.dial_format === 'intl' ? t('telephony.dialFormatIntl') : t('telephony.dialFormatLocal')}</span></div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditTrunk(trunk)}
                          className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-xs"
                        >
                          {t('telephony.edit')}
                        </button>
                        <div className={`px-2 py-1 rounded text-xs font-semibold ${
                          trunk.enabled ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                        }`}>
                          {trunk.enabled ? t('telephony.enabled') : t('telephony.disabled')}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
