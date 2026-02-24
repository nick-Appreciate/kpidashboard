'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { LogoLoader } from './Logo';
import { useAuth } from '../contexts/AuthContext';
import JustCallDialer, { useJustCall } from './JustCallDialer';

export default function ContactsDashboard() {
  const { user, appUser } = useAuth();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setType] = useState('all');
  const [results, setResults] = useState({ tenants: [], vendors: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceTimer = useRef(null);
  
  // Tape feed state
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [noteType, setNoteType] = useState('general');
  const [addingNote, setAddingNote] = useState(false);
  
  // JustCall embedded dialer
  const { makeCall } = useJustCall();

  // Escape key handler to close modals
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (selectedContact) {
          setSelectedContact(null);
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedContact]);

  const formatPhoneForJustCall = (phone) => {
    if (!phone) return null;
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+')) {
      if (cleaned.startsWith('1') && cleaned.length === 11) {
        cleaned = '+' + cleaned;
      } else {
        cleaned = '+1' + cleaned;
      }
    }
    return cleaned;
  };

  const openJustCallDialer = (contact) => {
    const phone = formatPhoneForJustCall(contact.phone);
    if (!phone) {
      alert('No phone number available for this contact');
      return;
    }
    makeCall(phone, contact.name);
  };
  
  // Debounce search input
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [search]);

  // Fetch tape feed notes
  const fetchNotes = useCallback(async () => {
    try {
      setNotesLoading(true);
      const res = await fetch('/api/contact-notes?limit=100');
      const data = await res.json();
      if (data.notes) {
        setNotes(data.notes);
      }
    } catch (err) {
      console.error('Error fetching notes:', err);
    } finally {
      setNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const addNote = async (contact) => {
    if (!newNote.trim()) return;
    
    try {
      setAddingNote(true);
      const res = await fetch('/api/contact-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactType: contact.type,
          contactId: contact.id,
          contactName: contact.name,
          propertyName: contact.property,
          unit: contact.unit,
          note: newNote.trim(),
          noteType: noteType,
          userEmail: user?.email || appUser?.email
        })
      });
      
      const data = await res.json();
      if (data.note) {
        setNotes(prev => [data.note, ...prev]);
        setNewNote('');
        setSelectedContact(null);
      }
    } catch (err) {
      console.error('Error adding note:', err);
    } finally {
      setAddingNote(false);
    }
  };

  // Group notes by contact for tape feed display
  const groupedNotes = notes.reduce((acc, note) => {
    const key = `${note.contact_type}-${note.contact_id}`;
    if (!acc[key]) {
      acc[key] = {
        contactType: note.contact_type,
        contactId: note.contact_id,
        contactName: note.contact_name,
        propertyName: note.property_name,
        unit: note.unit,
        notes: []
      };
    }
    acc[key].notes.push(note);
    return acc;
  }, {});

  // Sort grouped notes: tenants first (by property, then unit), then vendors
  const sortedGroups = Object.values(groupedNotes).sort((a, b) => {
    if (a.contactType !== b.contactType) {
      return a.contactType === 'tenant' ? -1 : 1;
    }
    if (a.contactType === 'tenant') {
      if (a.propertyName !== b.propertyName) {
        return (a.propertyName || '').localeCompare(b.propertyName || '');
      }
      return (a.unit || '').localeCompare(b.unit || '', undefined, { numeric: true });
    }
    return (a.contactName || '').localeCompare(b.contactName || '');
  });

  const formatNoteDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const noteTypeColors = {
    general: 'bg-slate-100 text-slate-700',
    call: 'bg-green-100 text-green-700',
    email: 'bg-blue-100 text-blue-700',
    payment: 'bg-yellow-100 text-yellow-700',
    maintenance: 'bg-orange-100 text-orange-700'
  };

  const fetchContacts = useCallback(async (searchTerm) => {
    if (!searchTerm || searchTerm.length < 2) {
      setResults({ tenants: [], vendors: [] });
      return;
    }
    
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('search', searchTerm);
      params.append('type', type);
      
      const res = await fetch(`/api/contacts?${params}`);
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setResults(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching contacts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [type]);

  // Auto-search when debounced search changes
  useEffect(() => {
    fetchContacts(debouncedSearch);
  }, [debouncedSearch, fetchContacts]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchContacts(search);
  };

  const totalResults = results.tenants.length + results.vendors.length;

  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-800 mb-1">
            Contacts
          </h1>
          <p className="text-slate-500 text-sm">
            Search tenants and vendors to call
          </p>
        </div>

        {/* Search Form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Start typing to search contacts (min 2 characters)..."
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              {loading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}
            </div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="px-4 py-3 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
            >
              <option value="all">All Contacts</option>
              <option value="tenants">Tenants Only</option>
              <option value="vendors">Vendors Only</option>
            </select>
          </div>
        </div>

        {/* Results */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-red-700">
            Error: {error}
          </div>
        )}

        {!loading && totalResults > 0 && (
          <div className="space-y-6">
            <p className="text-slate-600">
              Found <span className="font-semibold">{totalResults}</span> contact{totalResults !== 1 ? 's' : ''}
              {search && <span> matching "<span className="font-medium">{search}</span>"</span>}
            </p>

            {/* Tenants Section */}
            {(type === 'all' || type === 'tenants') && results.tenants.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-indigo-50 px-6 py-3 border-b border-indigo-100">
                  <h2 className="font-semibold text-indigo-800">Tenants ({results.tenants.length})</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {results.tenants.map((contact, idx) => (
                    <div key={`tenant-${idx}`} className="p-4 hover:bg-slate-50 transition">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {contact.appfolioUrl ? (
                              <a 
                                href={contact.appfolioUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                              >
                                {contact.name}
                              </a>
                            ) : (
                              <span className="font-semibold text-slate-900">{contact.name}</span>
                            )}
                            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                              Tenant
                            </span>
                          </div>
                          <div className="text-sm text-slate-600">
                            {contact.property && <span>{contact.property}</span>}
                            {contact.unit && <span> - Unit {contact.unit}</span>}
                          </div>
                          <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-3">
                            {contact.phone && (
                              <button
                                onClick={() => openJustCallDialer(contact)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md transition-colors cursor-pointer"
                                title="Click to call with JustCall"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                                </svg>
                                <span>{contact.phone}</span>
                              </button>
                            )}
                            {contact.email && (
                              <a 
                                href={`mailto:${contact.email}`}
                                className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors"
                              >
                                ✉️ {contact.email}
                              </a>
                            )}
                            <button
                              onClick={() => setSelectedContact(contact)}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors"
                            >
                              + Note
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Vendors Section */}
            {(type === 'all' || type === 'vendors') && results.vendors.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-orange-50 px-6 py-3 border-b border-orange-100">
                  <h2 className="font-semibold text-orange-800">Vendors ({results.vendors.length})</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {results.vendors.map((contact, idx) => (
                    <div key={`vendor-${idx}`} className="p-4 hover:bg-slate-50 transition">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {contact.appfolioUrl ? (
                              <a 
                                href={contact.appfolioUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                              >
                                {contact.name}
                              </a>
                            ) : (
                              <span className="font-semibold text-slate-900">{contact.name}</span>
                            )}
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                              Vendor
                            </span>
                          </div>
                          {contact.companyName && contact.companyName !== contact.name && (
                            <div className="text-sm text-slate-600">{contact.companyName}</div>
                          )}
                          {contact.trades && (
                            <div className="text-xs text-slate-500">{contact.trades}</div>
                          )}
                          <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-3">
                            {contact.phone && (
                              <button
                                onClick={() => openJustCallDialer(contact)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md transition-colors cursor-pointer"
                                title="Click to call with JustCall"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                                </svg>
                                <span>{contact.phone}</span>
                              </button>
                            )}
                            {contact.email && (
                              <a 
                                href={`mailto:${contact.email}`}
                                className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors"
                              >
                                ✉️ {contact.email}
                              </a>
                            )}
                            <button
                              onClick={() => setSelectedContact(contact)}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors"
                            >
                              + Note
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {!loading && search.length >= 2 && totalResults === 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
            No contacts found matching "{search}"
          </div>
        )}

        {!loading && search.length < 2 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
            <p className="text-lg mb-2">Search for contacts</p>
            <p className="text-sm">Start typing to find tenants and vendors (minimum 2 characters)</p>
          </div>
        )}

        {/* Tape Feed Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mt-6">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-800">Activity Feed</h2>
            <p className="text-sm text-slate-500">Recent notes grouped by contact</p>
          </div>
          
          {notesLoading ? (
            <div className="p-8 text-center">
              <LogoLoader text="Loading activity..." />
            </div>
          ) : sortedGroups.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p className="text-lg mb-2">No activity yet</p>
              <p className="text-sm">Notes will appear here when you add them to contacts</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sortedGroups.map((group) => (
                <div key={`${group.contactType}-${group.contactId}`} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      group.contactType === 'tenant' ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {group.contactType === 'tenant' ? 'Tenant' : 'Vendor'}
                    </span>
                    <span className="font-semibold text-slate-900">{group.contactName}</span>
                    {group.contactType === 'tenant' && group.propertyName && (
                      <span className="text-sm text-slate-500">
                        {group.propertyName}{group.unit ? ` - Unit ${group.unit}` : ''}
                      </span>
                    )}
                    <button
                      onClick={() => setSelectedContact({
                        type: group.contactType,
                        id: group.contactId,
                        name: group.contactName,
                        property: group.propertyName,
                        unit: group.unit
                      })}
                      className="ml-auto text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded transition"
                    >
                      + Add Note
                    </button>
                  </div>
                  
                  <div className="space-y-2 ml-4 border-l-2 border-slate-200 pl-4">
                    {group.notes.slice(0, 5).map((note) => (
                      <div key={note.id} className="text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${noteTypeColors[note.note_type] || noteTypeColors.general}`}>
                            {note.note_type}
                          </span>
                          <span className="text-xs text-slate-400">{formatNoteDate(note.created_at)}</span>
                          {note.created_by_email && (
                            <span className="text-xs text-slate-400">by {note.created_by_email.split('@')[0]}</span>
                          )}
                        </div>
                        <p className="text-slate-700">{note.note}</p>
                      </div>
                    ))}
                    {group.notes.length > 5 && (
                      <p className="text-xs text-slate-400">+ {group.notes.length - 5} more notes</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Note Modal */}
        {selectedContact && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-1">Add Note</h3>
              <p className="text-sm text-slate-500 mb-4">
                {selectedContact.name}
                {selectedContact.property && ` - ${selectedContact.property}`}
                {selectedContact.unit && ` Unit ${selectedContact.unit}`}
              </p>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Note Type</label>
                <select
                  value={noteType}
                  onChange={(e) => setNoteType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="general">General</option>
                  <option value="call">Call</option>
                  <option value="email">Email</option>
                  <option value="payment">Payment</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Note</label>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Enter your note..."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none"
                />
              </div>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setSelectedContact(null);
                    setNewNote('');
                  }}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => addNote(selectedContact)}
                  disabled={addingNote || !newNote.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {addingNote ? 'Adding...' : 'Add Note'}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* JustCall Embedded Dialer */}
        <JustCallDialer />
      </div>
    </div>
  );
}
