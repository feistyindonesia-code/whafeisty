import { useEffect, useState, useCallback } from 'react';
import { Search, Phone, User, Clock, Send } from 'lucide-react';
import axios from 'axios';

const API_BASE = '/api/v1/features';

interface Conversation {
  phone_number: string;
  device_id: string;
  last_message: string | null;
  last_message_at: string | null;
  direction: string;
  consent_status: string | null;
}

interface Message {
  id: string;
  from_number: string;
  to_number: string;
  content: string;
  status: string;
  direction: string;
  created_at: string;
}

export default function CustomerServiceInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState({ text: '', type: 'info' as 'success' | 'error' | 'info' });

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_BASE + '/customer-service/conversations', { params: { q: search } });
      setConversations(res.data.data || []);
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memuat percakapan.', type: 'error' });
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const selectConversation = (phone: string) => {
    setSelectedPhone(phone);
    loadMessages(phone);
  };

  const loadMessages = useCallback(async (phone: string) => {
    try {
      const res = await axios.get(API_BASE + '/customer-service/conversations/' + encodeURIComponent(phone) + '/messages');
      setMessages((res.data.data || []).reverse());
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memuat riwayat pesan.', type: 'error' });
    }
  }, []);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPhone || !newMessage.trim()) return;
    setSending(true);
    try {
      await axios.post(API_BASE + '/customer-service/reply', {
        to_number: selectedPhone, content: newMessage.trim(),
      });
      setNewMessage('');
      setMessage({ text: 'Balasan berhasil dikirim.', type: 'success' });
      await loadMessages(selectedPhone);
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal mengirim balasan.', type: 'error' });
    } finally { setSending(false); }
  };

  const renderMessage = () => {
    if (!message.text) return null;
    let bgColor = 'bg-blue-50';
    let textColor = 'text-blue-700';
    let borderColor = 'border-blue-200';
    if (message.type === 'success') {
      bgColor = 'bg-green-50';
      textColor = 'text-green-700';
      borderColor = 'border-green-200';
    } else if (message.type === 'error') {
      bgColor = 'bg-red-50';
      textColor = 'text-red-700';
      borderColor = 'border-red-200';
    }
    return (
      <div className={'mb-4 p-3 rounded-lg text-sm ' + bgColor + ' ' + textColor + ' ' + borderColor}>
        {message.text}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Customer Service</h2>
          <p className="text-sm text-gray-500">Mengelola percakapan masuk dan membalas pesan customer.</p>
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Cari nomor telepon..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm" />
        </div>
      </div>

      {renderMessage()}

      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-200px)]">
        <div className="flex-1 bg-white rounded-lg shadow border border-gray-200 flex flex-col h-full">
          <div className="p-4 border-b border-gray-200 font-semibold text-gray-900">Percakapan</div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-gray-500">{loading ? 'Memuat percakapan...' : 'Belum ada percakapan.'}</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {conversations.map((conv) => (
                  <button key={conv.phone_number} onClick={() => selectConversation(conv.phone_number)}
                    className={'w-full p-4 text-left transition ' + (selectedPhone === conv.phone_number ? 'bg-primary-50 border-l-4 border-l-primary-600' : 'hover:bg-gray-50 border-l-4 border-l-transparent')}>
                    <div className="flex items-center gap-3">
                      <Phone className="w-5 h-5 text-gray-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm">{conv.phone_number}</p>
                        <p className="text-xs text-gray-500 truncate">{conv.last_message || 'Belum ada pesan'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-500">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString('id-ID') : '-'}</p>
                        <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ' + (conv.consent_status === 'opted_in' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600')}>
                          {conv.consent_status || 'none'}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedPhone ? (
          <div className="w-full lg:w-3/4 bg-white rounded-lg shadow border border-gray-200 flex flex-col h-full">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <User className="w-6 h-6 text-gray-400" />
                <div>
                  <h3 className="font-semibold text-gray-900">{selectedPhone}</h3>
                  <p className="text-xs text-gray-500">Percakapan WhatsApp</p>
                </div>
              </div>
              <button onClick={() => setSelectedPhone(null)} className="text-gray-400 hover:text-gray-600">
                <Clock className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-gray-500 text-sm mt-10">Belum ada pesan. Kirim balasan pertama.</div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={'max-w-[80%] ' + (msg.direction === 'outbound' ? 'ml-auto' : 'mr-auto')}>
                    <div className={'p-3 rounded-lg ' + (msg.direction === 'outbound' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-900')}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <p className="text-[10px] text-gray-400 text-right mt-1">{new Date(msg.created_at).toLocaleTimeString('id-ID')}</p>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <form onSubmit={sendReply} className="flex gap-2">
                <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Ketik balasan..." rows={1}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none text-sm" />
                <button type="submit" disabled={sending || !newMessage.trim()}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium">
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-gray-50 flex items-center justify-center">
            <p className="text-gray-400 text-sm">Pilih percakapan dari daftar di kiri untuk mulai membalas.</p>
          </div>
        )}
      </div>
    </div>
  );
}
