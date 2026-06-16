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

/**
 * AIProviders – displays registered AI model providers and lets the user add new ones.
 * Uses a simple modal form; in a real implementation the modal could be a separate component.
 */
export const AIProviders: React.FC = () => {
  const [providers, setProviders] = useState<any[]>([])
  const [showModal, setShowModal] = useState(false)
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
      setProviders(res.data)
    } catch (e) {
      console.error('Failed to load providers', e)
    }
  }

  useEffect(() => {
    fetchProviders()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await axios.post('/api/providers', form)
      setShowModal(false)
      setForm({ name: '', type: 'OPENAI', baseURL: '', modelName: '', apiKey: '' })
      fetchProviders()
    } catch (err) {
      console.error('Add provider error', err)
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
        <div className="modal" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <form onSubmit={handleSubmit} style={{ background: '#1e1e1e', padding: 20, borderRadius: 4 }}>
            <h4>Add New Provider</h4>
            <label>Name:<br />
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            </label><br />
            <label>Type:<br />
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option value="OPENAI">OPENAI</option>
                <option value="ANTHROPIC">ANTHROPIC</option>
                <option value="GENERIC_REST">GENERIC_REST</option>
              </select>
            </label><br />
            <label>Base URL:<br />
              <input type="url" value={form.baseURL} onChange={e => setForm({ ...form, baseURL: e.target.value })} required />
            </label><br />
            <label>Model Name:<br />
              <input type="text" value={form.modelName} onChange={e => setForm({ ...form, modelName: e.target.value })} required />
            </label><br />
            <label>API Key:<br />
              <input type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} required />
            </label><br />
            <button type="submit" style={{ marginTop: 10 }}>Save</button>
            <button type="button" onClick={() => setShowModal(false)} style={{ marginLeft: 10 }}>
              Cancel
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
