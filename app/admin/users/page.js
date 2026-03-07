'use client';

import { useAuth } from '../../../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Users, Shield, Clock, Plus, Pencil, Mail, X, Loader2, UserCheck, UserX } from 'lucide-react';

export default function UsersPage() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // user id being acted on
  const [showAddModal, setShowAddModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [feedback, setFeedback] = useState(null);

  // Add user form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('user');

  // Edit user form state
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('user');

  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (appUser?.role === 'admin') fetchUsers();
  }, [appUser, fetchUsers]);

  const showFeedback = useCallback((message, type = 'success') => {
    setFeedback({ message, type });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  // Stats
  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter(u => u.role === 'admin').length;
    const pendingAuth = users.filter(u => u.is_active && !u.auth_user_id).length;
    return { total, admins, pendingAuth };
  }, [users]);

  // ── Add user ──
  const handleAddUser = useCallback(async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setActionLoading('add');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, email: newEmail, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'Failed to add user', 'error');
        return;
      }
      showFeedback(`Added ${data.user.name}`);
      setShowAddModal(false);
      setNewName('');
      setNewEmail('');
      setNewRole('user');
      await fetchUsers();
    } catch (err) {
      showFeedback('Failed to add user', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [newName, newEmail, newRole, fetchUsers, showFeedback]);

  // ── Edit user ──
  const openEdit = useCallback((user) => {
    setEditUser(user);
    setEditName(user.name || '');
    setEditRole(user.role || 'user');
  }, []);

  const handleEditUser = useCallback(async () => {
    if (!editUser) return;
    setActionLoading(editUser.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editUser.id, name: editName, role: editRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'Failed to update user', 'error');
        return;
      }
      showFeedback(`Updated ${data.user.name}`);
      setEditUser(null);
      await fetchUsers();
    } catch (err) {
      showFeedback('Failed to update user', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [editUser, editName, editRole, fetchUsers, showFeedback]);

  // ── Toggle active ──
  const toggleActive = useCallback(async (user) => {
    setActionLoading(user.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, is_active: !user.is_active }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'Failed to update user', 'error');
        return;
      }
      showFeedback(`${data.user.name} is now ${data.user.is_active ? 'active' : 'inactive'}`);
      await fetchUsers();
    } catch (err) {
      showFeedback('Failed to update user', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [fetchUsers, showFeedback]);

  // ── Send invite ──
  const sendInvite = useCallback(async (user) => {
    setActionLoading(user.id);
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, name: user.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || 'Failed to send invite', 'error');
        return;
      }
      showFeedback(`Invite sent to ${user.email}`);
      await fetchUsers();
    } catch (err) {
      showFeedback('Failed to send invite', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [fetchUsers, showFeedback]);

  // ── Loading / auth guard ──
  if (authLoading || appUser?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-sm text-slate-400 mt-1">Manage team members and access</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-accent flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Users className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.total}</p>
              <p className="text-xs text-slate-400">Total Users</p>
            </div>
          </div>
        </div>
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Shield className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.admins}</p>
              <p className="text-xs text-slate-400">Admins</p>
            </div>
          </div>
        </div>
        <div className="glass-stat group">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.pendingAuth}</p>
              <p className="text-xs text-slate-400">Pending Auth</p>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div className={`px-4 py-2.5 rounded-lg text-sm ${
          feedback.type === 'error'
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
        }`}>
          {feedback.message}
        </div>
      )}

      {/* Users table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading users...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur">
              <tr className="border-b border-white/10">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Email</th>
                <th className="text-center px-4 py-3 text-slate-400 font-medium w-24">Role</th>
                <th className="text-center px-4 py-3 text-slate-400 font-medium w-24">Status</th>
                <th className="text-center px-4 py-3 text-slate-400 font-medium w-24">Auth</th>
                <th className="text-center px-4 py-3 text-slate-400 font-medium w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isActing = actionLoading === user.id;
                return (
                  <tr
                    key={user.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-white">{user.name || '—'}</span>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 text-slate-400">
                      {user.email}
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        user.role === 'admin'
                          ? 'bg-cyan-500/15 text-cyan-400'
                          : 'bg-slate-500/15 text-slate-400'
                      }`}>
                        {user.role === 'admin' && <Shield className="w-3 h-3" />}
                        {user.role}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-full ${
                          user.is_active ? 'bg-emerald-400' : 'bg-red-400'
                        }`} />
                        <span className={user.is_active ? 'text-emerald-400' : 'text-red-400'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                    </td>

                    {/* Auth */}
                    <td className="px-4 py-3 text-center">
                      {user.auth_user_id ? (
                        <span className="text-xs text-emerald-400">Linked</span>
                      ) : (
                        <button
                          onClick={() => sendInvite(user)}
                          disabled={isActing || !user.is_active}
                          className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
                          title="Send login invite"
                        >
                          {isActing ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Mail className="w-3 h-3" />
                          )}
                          Invite
                        </button>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(user)}
                          disabled={isActing}
                          className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-50"
                          title="Edit user"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleActive(user)}
                          disabled={isActing}
                          className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
                            user.is_active
                              ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'
                              : 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10'
                          }`}
                          title={user.is_active ? 'Deactivate user' : 'Activate user'}
                        >
                          {isActing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : user.is_active ? (
                            <UserX className="w-3.5 h-3.5" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add User Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">Add User</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                  className="dark-input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="name@appreciate.io"
                  className="dark-input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="dark-select w-full"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 border border-white/10 text-slate-300 rounded-lg hover:bg-white/5 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddUser}
                disabled={!newName.trim() || !newEmail.trim() || actionLoading === 'add'}
                className="flex-1 btn-accent px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {actionLoading === 'add' ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Adding...
                  </span>
                ) : (
                  'Add User'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">Edit User</h3>
              <button
                onClick={() => setEditUser(null)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-400 mb-4">{editUser.email}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="dark-input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="dark-select w-full"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditUser(null)}
                className="flex-1 px-4 py-2 border border-white/10 text-slate-300 rounded-lg hover:bg-white/5 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditUser}
                disabled={!editName.trim() || actionLoading === editUser.id}
                className="flex-1 btn-accent px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {actionLoading === editUser.id ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
