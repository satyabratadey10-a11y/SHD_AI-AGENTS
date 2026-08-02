import React, { useEffect, useState } from 'react'
import axios from 'axios'

// Mock file tree interface
interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

/**
 * FileExplorer – displays a simple clickable mock directory tree.
 * Clicking a file calls the optional `onSelect` callback with the file's path.
 */
export const FileExplorer: React.FC<{ onSelect?: (path: string) => void }> = ({ onSelect }) => {
  const [tree, setTree] = useState<FileNode[]>([])

  useEffect(() => {
    // In a real app this would call the backend API to fetch the tree.
    // Here we provide a static placeholder.
    const mock: FileNode[] = [
      { name: 'src', path: '/src', type: 'folder', children: [
        { name: 'index.ts', path: '/src/index.ts', type: 'file' },
        { name: 'utils', path: '/src/utils', type: 'folder', children: [
          { name: 'helpers.ts', path: '/src/utils/helpers.ts', type: 'file' }
        ]}
      ]},
      { name: 'README.md', path: '/README.md', type: 'file' }
    ]
    setTree(mock)
  }, [])

  const renderNode = (node: FileNode) => (
    <li key={node.path} style={{ marginLeft: node.type === 'folder' ? 0 : 20 }}>
      {node.type === 'folder' ? (
        <span>{node.name}/</span>
      ) : (
        <button
          type="button"
          onClick={() => onSelect?.(node.path)}
          style={{ background: 'none', border: 'none', color: '#61dafb', cursor: 'pointer' }}
        >
          {node.name}
        </button>
      )}
      {node.children && (
        <ul style={{ listStyle: 'none', paddingLeft: 15 }}>
          {node.children.map(renderNode)}
        </ul>
      )}
    </li>
  )

  return (
    <section className="file-explorer">
      <h3>File Explorer</h3>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>{tree.map(renderNode)}</ul>
    </section>
  )
}

// Style constants defined outside the component to keep JSX pure and security-compliant.
const MODAL_OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const MODAL_FORM_STYLE: React.CSSProperties = {
  background: '#1e1e1e',
  padding: 20,
  borderRadius: 4,
  width: '300px'
}

const FORM_FIELD_STYLE: React.CSSProperties = {
  display: 'block',
  marginBottom: 8
}

const FORM_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 4
}

/**
 * AIProviders – displays registered AI model providers and lets the user add new ones.
 * Uses a simple modal form; in a real implementation the modal could be a separate component.
 */
export const AIProviders: React.FC = () => {
  const [providers, setProviders] = useState<any[]>([])
  const [showModal, setShowModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'OPENAI',
    baseURL: '',
    modelName: '',
    apiKey: ''
  })

  const fetchProviders = async () => {
    try {
      const res = await axios.get('/api/providers')
      if (Array.isArray(res.data)) {
        setProviders(res.data)
      } else {
        console.warn('Failed to load providers: response format mismatch')
      }
    } catch (e) {
      console.error('Failed to load providers', e)
    }
  }

  useEffect(() => {
    fetchProviders()
  }, [])

  useEffect(() => {
    if (!showModal) return
    setError(null)
    setIsSubmitting(false)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showModal])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await axios.post('/api/providers', form)
      setShowModal(false)
      setForm({ name: '', type: 'OPENAI', baseURL: '', modelName: '', apiKey: '' })
      fetchProviders()
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to add provider')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="ai-providers" style={{ marginTop: 20 }}>
      <h3>AI Providers</h3>
      <ul>
        {providers.map(p => (
          <li key={p.id}>
            <strong>{p.name}</strong> – {p.type} – {p.baseURL} – {p.modelName}
          </li>
        ))}
      </ul>
      <button onClick={() => setShowModal(true)} style={{ marginTop: 10 }}>
        Add Provider
      </button>

      {showModal && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          style={MODAL_OVERLAY_STYLE}
        >
          <form onSubmit={handleSubmit} style={MODAL_FORM_STYLE}>
            <h4 id="modal-title" style={{ marginTop: 0, marginBottom: 15 }}>Add New Provider</h4>

            {error && (
              <div style={{ color: '#ff6b6b', marginBottom: 10, fontSize: '0.85rem' }} role="alert">
                {error}
              </div>
            )}

            <label htmlFor="provider-name" style={FORM_FIELD_STYLE}>Name:<br />
              <input
                id="provider-name"
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
                autoFocus
                disabled={isSubmitting}
                style={FORM_INPUT_STYLE}
              />
            </label>
            <label htmlFor="provider-type" style={FORM_FIELD_STYLE}>Type:<br />
              <select
                id="provider-type"
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value })}
                disabled={isSubmitting}
                style={FORM_INPUT_STYLE}
              >
                <option value="OPENAI">OPENAI</option>
                <option value="ANTHROPIC">ANTHROPIC</option>
                <option value="GENERIC_REST">GENERIC_REST</option>
              </select>
            </label>
            <label htmlFor="provider-url" style={FORM_FIELD_STYLE}>Base URL:<br />
              <input
                id="provider-url"
                type="url"
                value={form.baseURL}
                onChange={e => setForm({ ...form, baseURL: e.target.value })}
                required
                disabled={isSubmitting}
                style={FORM_INPUT_STYLE}
              />
            </label>
            <label htmlFor="provider-model" style={FORM_FIELD_STYLE}>Model Name:<br />
              <input
                id="provider-model"
                type="text"
                value={form.modelName}
                onChange={e => setForm({ ...form, modelName: e.target.value })}
                required
                disabled={isSubmitting}
                style={FORM_INPUT_STYLE}
              />
            </label>
            <label htmlFor="provider-key" style={{ display: 'block', marginBottom: 15 }}>API Key:<br />
              <input
                id="provider-key"
                type="password"
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                required
                disabled={isSubmitting}
                style={FORM_INPUT_STYLE}
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={() => setShowModal(false)} disabled={isSubmitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
