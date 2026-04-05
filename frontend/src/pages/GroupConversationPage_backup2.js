import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getUser } from '@/lib/db';
import {
  getGroupInfo,
  getGroupMembers,
  sendGroupMessage,
  subscribeToGroupMessages,
  markGroupMessagesAsRead,
  deleteGroupMessageForMe,
  deleteGroupMessageForEveryone,
  isGroupMember,
  isGroupAdmin,
  GROUP_STATUS
} from '@/lib/groupsDb';
import { getCachedGroupMessages, cacheGroupMessages } from '@/lib/cacheManager';
import Header from '@/components/Header';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Send, Info, Loader2, Copy, Reply, Trash2, MoreVertical, X
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export default function GroupConversationPage() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [groupInfo, setGroupInfo] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [isMember, setIsMember] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userDetails, setUserDetails] = useState({});
  
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState(null);
  const [deleteForEveryone, setDeleteForEveryone] = useState(false);
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const messageRefs = useRef({});

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Scroll to specific message
  const scrollToMessage = useCallback((messageId) => {
    const messageElement = messageRefs.current[messageId];
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      messageElement.classList.add('highlight-message');
      setTimeout(() => {
        messageElement.classList.remove('highlight-message');
      }, 2000);
    }
  }, []);

  // Load group data
  useEffect(() => {
    if (!user?.id || !groupId) return;

    const loadGroupData = async () => {
      try {
        // Get cached messages first
        const cachedMessages = await getCachedGroupMessages(groupId);
        if (cachedMessages && cachedMessages.length > 0) {
          setMessages(cachedMessages);
          setLoading(false);
        }

        // Check membership
        const memberStatus = await isGroupMember(groupId, user.id);
        setIsMember(memberStatus);

        if (!memberStatus) {
          setLoading(false);
          return;
        }

        // Check admin status
        const adminStatus = await isGroupAdmin(groupId, user.id);
        setIsAdmin(adminStatus);

        // Get group info
        const info = await getGroupInfo(groupId);
        setGroupInfo(info);

        // Get members
        const membersList = await getGroupMembers(groupId);
        setMembers(membersList);

        // Load user details for all members
        const details = {};
        for (const member of membersList) {
          try {
            const userData = await getUser(member.userId);
            if (userData) {
              details[member.userId] = userData;
            }
          } catch (err) {
            console.error('Error loading user:', err);
          }
        }
        setUserDetails(details);

        // Mark messages as read
        await markGroupMessagesAsRead(groupId, user.id);
      } catch (error) {
        console.error('Error loading group data:', error);
        toast.error('Failed to load group');
      } finally {
        setLoading(false);
      }
    };

    loadGroupData();

    // Subscribe to real-time messages
    const unsubscribe = subscribeToGroupMessages(groupId, async (newMessages) => {
      setMessages(newMessages);
      await cacheGroupMessages(groupId, newMessages);
      
      // Mark as read
      await markGroupMessagesAsRead(groupId, user.id);
    });

    return () => unsubscribe();
  }, [user?.id, groupId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    
    if (!messageText.trim() || sending) return;

    setSending(true);
    try {
      await sendGroupMessage(groupId, user.id, messageText, replyTo);
      setMessageText('');
      setReplyTo(null);
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error(error.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleReply = (message) => {
    setReplyTo(message);
    inputRef.current?.focus();
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Message copied to clipboard');
  };

  const handleDeleteMessage = async () => {
    if (!messageToDelete) return;

    try {
      if (deleteForEveryone) {
        await deleteGroupMessageForEveryone(groupId, messageToDelete.id, user.id);
        toast.success('Message deleted for everyone');
      } else {
        await deleteGroupMessageForMe(groupId, messageToDelete.id, user.id);
        toast.success('Message deleted');
      }
    } catch (error) {
      console.error('Error deleting message:', error);
      toast.error(error.message || 'Failed to delete message');
    } finally {
      setDeleteDialogOpen(false);
      setMessageToDelete(null);
      setDeleteForEveryone(false);
    }
  };

  const openDeleteDialog = (message, forEveryone = false) => {
    setMessageToDelete(message);
    setDeleteForEveryone(forEveryone);
    setDeleteDialogOpen(true);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  // Group messages by date
  const groupMessagesByDate = (messages) => {
    const grouped = {};
    messages.forEach((msg) => {
      const date = formatDate(msg.timestamp);
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(msg);
    });
    return grouped;
  };

  const renderMessage = (message) => {
    const isOwn = message.sender === user.id;
    const senderDetails = userDetails[message.sender];
    const isSystemMessage = message.type === 'system';

    // System message
    if (isSystemMessage) {
      return (
        <div key={message.id} className="flex justify-center my-4">
          <div className="bg-neutral-200 dark:bg-neutral-700 discuss:bg-[#333333] px-4 py-2 rounded-full">
            <p className="text-xs text-neutral-600 dark:text-neutral-300 discuss:text-[#9CA3AF] text-center">
              {message.text}
            </p>
          </div>
        </div>
      );
    }

    // Regular message
    return (
      <div
        key={message.id}
        ref={(el) => (messageRefs.current[message.id] = el)}
        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3 message-item`}
      >
        <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
          {!isOwn && (
            <div className="flex items-center gap-1 mb-1 ml-1">
              <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5]">
                @{senderDetails?.username || 'User'}
              </span>
              {senderDetails?.verified && <VerifiedBadge size="xs" />}
            </div>
          )}
          
          <div className="relative group">
            <div
              className={`rounded-[16px] px-4 py-2.5 ${
                isOwn
                  ? 'bg-[#2563EB] discuss:bg-[#EF4444] text-white'
                  : 'bg-white dark:bg-neutral-800 discuss:bg-[#1a1a1a] text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5] border border-neutral-200 dark:border-neutral-700 discuss:border-[#333333]'
              }`}
            >
              {/* Reply preview */}
              {message.replyTo && (
                <button
                  onClick={() => scrollToMessage(message.replyTo.id)}
                  className={`mb-2 p-2 rounded-[8px] border-l-2 text-left w-full ${
                    isOwn
                      ? 'bg-white/10 border-white/30'
                      : 'bg-neutral-100 dark:bg-neutral-700 discuss:bg-[#262626] border-neutral-300 dark:border-neutral-600 discuss:border-[#404040]'
                  }`}
                >
                  <p className={`text-[10px] font-semibold mb-0.5 ${isOwn ? 'text-white/70' : 'text-neutral-500 dark:text-neutral-400'}`}>
                    @{userDetails[message.replyTo.sender]?.username || 'User'}
                  </p>
                  <p className={`text-xs truncate ${isOwn ? 'text-white/90' : 'text-neutral-600 dark:text-neutral-300'}`}>
                    {message.replyTo.text}
                  </p>
                </button>
              )}

              {/* Message text */}
              <p className={`text-sm whitespace-pre-wrap break-words ${message.deleted ? 'italic opacity-60' : ''}`}>
                {message.text}
              </p>

              {/* Timestamp */}
              <p className={`text-[10px] mt-1 ${isOwn ? 'text-white/60' : 'text-neutral-400 dark:text-neutral-500'}`}>
                {formatTime(message.timestamp)}
              </p>
            </div>

            {/* Message actions */}
            {!message.deleted && (
              <div className={`absolute top-1/2 -translate-y-1/2 ${isOwn ? 'left-0 -translate-x-full' : 'right-0 translate-x-full'} opacity-0 group-hover:opacity-100 transition-opacity`}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 rounded-full bg-white dark:bg-neutral-800 discuss:bg-[#1a1a1a] border border-neutral-200 dark:border-neutral-700 discuss:border-[#333333] mx-2"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align={isOwn ? 'end' : 'start'}>
                    <DropdownMenuItem onClick={() => handleReply(message)}>
                      <Reply className="w-4 h-4 mr-2" />
                      Reply
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleCopy(message.text)}>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openDeleteDialog(message, false)}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete for Me
                    </DropdownMenuItem>
                    {(isOwn || isAdmin) && (
                      <DropdownMenuItem
                        onClick={() => openDeleteDialog(message, true)}
                        className="text-red-600 dark:text-red-400"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete for Everyone
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 discuss:bg-[#121212]">
        <Header />
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[#2563EB] discuss:text-[#EF4444] mb-3" />
          <p className="text-neutral-500 dark:text-neutral-400 discuss:text-[#9CA3AF] text-sm">
            Loading group chat...
          </p>
        </div>
      </div>
    );
  }

  const isDeleted = groupInfo?.status === GROUP_STATUS.DELETED;
  const canSendMessages = isMember && !isDeleted && 
    (!groupInfo?.settings?.adminOnlyMessaging || isAdmin);

  const groupedMessages = groupMessagesByDate(messages);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 discuss:bg-[#121212] flex flex-col">
      <Header />
      
      {/* Group header */}
      <div className="bg-white dark:bg-neutral-800 discuss:bg-[#1a1a1a] border-b border-neutral-200 dark:border-neutral-700 discuss:border-[#333333] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/chat')}
              className="p-2 rounded-[6px] hover:bg-neutral-100 dark:hover:bg-neutral-700 discuss:hover:bg-[#262626] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5]">
                  {groupInfo?.name || 'Group'}
                </h1>
                <span className="bg-[#2563EB]/10 discuss:bg-[#EF4444]/10 text-[#2563EB] discuss:text-[#EF4444] text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Group Chat
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 discuss:text-[#9CA3AF]">
                {isDeleted ? 'Group deleted' : `${members.length} members`}
              </p>
            </div>
          </div>
          {!isDeleted && (
            <button
              onClick={() => navigate(`/group/${groupId}/info`)}
              className="p-2 rounded-[6px] hover:bg-neutral-100 dark:hover:bg-neutral-700 discuss:hover:bg-[#262626] transition-colors"
            >
              <Info className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        <div className="max-w-2xl mx-auto">
          {!isMember ? (
            <div className="text-center py-16 bg-white dark:bg-neutral-800 discuss:bg-[#1a1a1a] rounded-[12px] border border-neutral-200 dark:border-neutral-700 discuss:border-[#333333]">
              <p className="text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5] font-semibold mb-2">
                You are no longer part of this group
              </p>
              <p className="text-neutral-500 dark:text-neutral-400 discuss:text-[#9CA3AF] text-sm">
                You can view old messages but cannot send new ones
              </p>
            </div>
          ) : isDeleted ? (
            <div className="text-center py-16 bg-amber-50 dark:bg-amber-950/30 discuss:bg-amber-950/30 rounded-[12px] border border-amber-200 dark:border-amber-800 discuss:border-amber-800">
              <p className="text-amber-900 dark:text-amber-200 discuss:text-amber-200 font-semibold mb-2">
                This group was deleted by an admin
              </p>
              <p className="text-amber-800 dark:text-amber-300 discuss:text-amber-300 text-sm">
                You can still view old messages
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-neutral-500 dark:text-neutral-400 discuss:text-[#9CA3AF]">
                No messages yet. Start the conversation!
              </p>
            </div>
          ) : null}

          {/* Render messages grouped by date */}
          {Object.entries(groupedMessages).map(([date, dateMessages]) => (
            <div key={date}>
              <div className="flex justify-center my-4">
                <div className="bg-neutral-200 dark:bg-neutral-700 discuss:bg-[#333333] px-3 py-1 rounded-full">
                  <p className="text-xs text-neutral-600 dark:text-neutral-300 discuss:text-[#9CA3AF] font-medium">
                    {date}
                  </p>
                </div>
              </div>
              {dateMessages.map(renderMessage)}
            </div>
          ))}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      {canSendMessages && (
        <div className="bg-white dark:bg-neutral-800 discuss:bg-[#1a1a1a] border-t border-neutral-200 dark:border-neutral-700 discuss:border-[#333333] px-4 py-3">
          <div className="max-w-2xl mx-auto">
            {/* Reply preview */}
            {replyTo && (
              <div className="mb-2 bg-neutral-100 dark:bg-neutral-700 discuss:bg-[#262626] p-2 rounded-[8px] border-l-2 border-[#2563EB] discuss:border-[#EF4444]">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#2563EB] discuss:text-[#EF4444]">
                      Replying to @{userDetails[replyTo.sender]?.username || 'User'}
                    </p>
                    <p className="text-xs text-neutral-600 dark:text-neutral-300 discuss:text-[#9CA3AF] truncate">
                      {replyTo.text}
                    </p>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="ml-2 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-600 discuss:hover:bg-[#333333] rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="flex gap-2">
              <Input
                ref={inputRef}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-neutral-100 dark:bg-neutral-700 discuss:bg-[#262626] border-neutral-200 dark:border-neutral-600 discuss:border-[#404040] text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5]"
                disabled={sending}
                maxLength={1000}
              />
              <Button
                type="submit"
                disabled={!messageText.trim() || sending}
                className="bg-[#2563EB] discuss:bg-[#EF4444] hover:bg-[#1D4ED8] discuss:hover:bg-[#DC2626] text-white px-4"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteForEveryone
                ? 'This message will be deleted for everyone in the group. This action cannot be undone.'
                : 'This message will be deleted for you only. Other members can still see it.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteMessage}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <style jsx global>{`
        .highlight-message {
          animation: highlight 2s ease-in-out;
        }
        @keyframes highlight {
          0%, 100% { background-color: transparent; }
          50% { background-color: rgba(37, 99, 235, 0.1); }
        }
        .message-item {
          transition: all 0.2s ease;
        }
      `}</style>
    </div>
  );
}
