import { useState, useEffect } from 'react'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { Wallet, Landmark, Save, ExternalLink, AlertTriangle } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { usePaymentConfig, DEFAULT_PAYMENT_CONFIG } from '../../../hooks/usePaymentConfig'

const inputCls =
  'w-full px-3.5 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm'

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function Field({ label, value, onChange, placeholder, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

export default function PaymentConfig() {
  const toast = useToast()
  const { config, loading } = usePaymentConfig()
  const [form, setForm] = useState(DEFAULT_PAYMENT_CONFIG)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (config) setForm(config)
  }, [config])

  function patch(section, key, val) {
    setForm((f) => ({ ...f, [section]: { ...f[section], [key]: val } }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(
        doc(db, 'config', 'payments'),
        {
          moneda: form.moneda || 'MXN',
          mercadoPago: {
            enabled: !!form.mercadoPago.enabled,
            publicKey: (form.mercadoPago.publicKey || '').trim(),
          },
          paypal: {
            enabled: !!form.paypal.enabled,
            clientId: (form.paypal.clientId || '').trim(),
          },
          transferencia: {
            enabled: !!form.transferencia.enabled,
            banco: (form.transferencia.banco || '').trim(),
            titular: (form.transferencia.titular || '').trim(),
            cuenta: (form.transferencia.cuenta || '').trim(),
            clabe: (form.transferencia.clabe || '').trim(),
            nota: (form.transferencia.nota || '').trim(),
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
      toast('Configuración de cobros guardada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Security notice */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-card px-4 py-3.5">
        <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 leading-relaxed">
          <p className="font-semibold mb-0.5">Las llaves secretas NO van aquí</p>
          Aquí solo se guardan datos públicos (Public Key de Mercado Pago, Client ID de PayPal, datos
          bancarios). El <strong>Access Token</strong> de Mercado Pago y el <strong>Secret</strong> de
          PayPal se configuran como variables de entorno en Vercel, nunca en la app.
        </div>
      </div>

      {/* Mercado Pago */}
      <div className="bg-surface-card rounded-card shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-sky-50 flex items-center justify-center">
              <Wallet size={20} className="text-sky-500" />
            </div>
            <div>
              <h3 className="font-semibold text-on-surface">Mercado Pago</h3>
              <p className="text-xs text-slate-400">Tarjeta, SPEI y OXXO</p>
            </div>
          </div>
          <Toggle
            checked={form.mercadoPago.enabled}
            onChange={(v) => patch('mercadoPago', 'enabled', v)}
          />
        </div>
        {form.mercadoPago.enabled && (
          <div className="space-y-3">
            <Field
              label="Public Key"
              value={form.mercadoPago.publicKey}
              onChange={(v) => patch('mercadoPago', 'publicKey', v)}
              placeholder="APP_USR-xxxxxxxx-xxxx-..."
              hint="Panel de Mercado Pago → Tus integraciones → Credenciales de producción."
            />
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <ExternalLink size={13} />
              El Access Token (secreto) va en Vercel como MP_ACCESS_TOKEN.
            </p>
          </div>
        )}
      </div>

      {/* PayPal */}
      <div className="bg-surface-card rounded-card shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center">
              <Wallet size={20} className="text-accent" />
            </div>
            <div>
              <h3 className="font-semibold text-on-surface">PayPal</h3>
              <p className="text-xs text-slate-400">Tarjeta y saldo PayPal</p>
            </div>
          </div>
          <Toggle checked={form.paypal.enabled} onChange={(v) => patch('paypal', 'enabled', v)} />
        </div>
        {form.paypal.enabled && (
          <div className="space-y-3">
            <Field
              label="Client ID"
              value={form.paypal.clientId}
              onChange={(v) => patch('paypal', 'clientId', v)}
              placeholder="AeA1QIZ..."
              hint="PayPal Developer Dashboard → tu app → Client ID (producción)."
            />
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <ExternalLink size={13} />
              El Secret va en Vercel como PAYPAL_SECRET.
            </p>
          </div>
        )}
      </div>

      {/* Bank transfer */}
      <div className="bg-surface-card rounded-card shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-emerald-50 flex items-center justify-center">
              <Landmark size={20} className="text-emerald-500" />
            </div>
            <div>
              <h3 className="font-semibold text-on-surface">Transferencia bancaria</h3>
              <p className="text-xs text-slate-400">Manual, con aprobación tuya</p>
            </div>
          </div>
          <Toggle
            checked={form.transferencia.enabled}
            onChange={(v) => patch('transferencia', 'enabled', v)}
          />
        </div>
        {form.transferencia.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Banco"
              value={form.transferencia.banco}
              onChange={(v) => patch('transferencia', 'banco', v)}
              placeholder="BBVA"
            />
            <Field
              label="Titular"
              value={form.transferencia.titular}
              onChange={(v) => patch('transferencia', 'titular', v)}
              placeholder="Nombre del titular"
            />
            <Field
              label="Número de cuenta"
              value={form.transferencia.cuenta}
              onChange={(v) => patch('transferencia', 'cuenta', v)}
              placeholder="0123456789"
            />
            <Field
              label="CLABE"
              value={form.transferencia.clabe}
              onChange={(v) => patch('transferencia', 'clabe', v)}
              placeholder="012345678901234567"
            />
            <div className="sm:col-span-2">
              <Field
                label="Nota para el docente"
                value={form.transferencia.nota}
                onChange={(v) => patch('transferencia', 'nota', v)}
                placeholder="Indica tu usuario en el concepto."
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? <Spinner size="sm" /> : <Save size={17} />}
          Guardar configuración
        </button>
      </div>
    </div>
  )
}
