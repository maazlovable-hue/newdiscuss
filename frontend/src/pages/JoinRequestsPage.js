import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getUser } from '@/lib/db';
import { getUserGroups, getGroupJoinRequests, acceptJoinRequest, rejectJoinRequest } from '@/lib/groupsDb';
import Header from '@/components/Header';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';

export default function JoinRequestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [requests, setRequests] = useState({});
  const [userDetails, setUserDetails] = useState({});

  useEffect(() => {
    if (!user?.id) return;

    const loadRequests = async () => {
      try {
        const userGroups = await getUserGroups(user.id);
        setGroups(userGroups);

        const allRequests = {};
        const details = {};

        for (const group of userGroups) {
          if (group.isMember) {
            const groupRequests = await getGroupJoinRequests(group.groupId);
            if (groupRequests.length > 0) {
              allRequests[group.groupId] = groupRequests;

              for (const req of groupRequests) {
                try {
                  const userData = await getUser(req.userId);
                  if (userData) details[req.userId] = userData;
                } catch (err) {
                  console.error('Error loading user:', err);
                }
              }
            }
          }
        }

        setRequests(allRequests);
        setUserDetails(details);
      } catch (error) {
        console.error('Error loading requests:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRequests();
  }, [user?.id]);

  const handleAccept = async (groupId, userId) => {
    try {
      await acceptJoinRequest(groupId, userId, user.id);
      setRequests(prev => ({
        ...prev,
        [groupId]: prev[groupId].filter(r => r.userId !== userId)
      }));
      toast.success('Request accepted');
    } catch (error) {
      toast.error('Failed to accept request');
    }
  };

  const handleReject = async (groupId, userId) => {
    try {
      await rejectJoinRequest(groupId, userId, user.id);
      setRequests(prev => ({
        ...prev,
        [groupId]: prev[groupId].filter(r => r.userId !== userId)
      }));
      toast.success('Request rejected');
    } catch (error) {
      toast.error('Failed to reject request');
    }
  };

  const totalRequests = Object.values(requests).reduce((sum, arr) => sum + arr.length, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 discuss:bg-[#121212]">
        <Header />
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[#2563EB] discuss:text-[#EF4444] mb-3" />
          <p className="text-neutral-500 dark:text-neutral-400 discuss:text-[#9CA3AF] text-sm">Loading requests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 discuss:bg-[#121212]">
      <Header />
      
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/chat')}
            className="p-2 rounded-[6px] hover:bg-white dark:hover:bg-neutral-800 discuss:hover:bg-[#1a1a1a] transition-colors border border-neutral-200 dark:border-neutral-700 discuss:border-[#333333]"
          >
            <ArrowLeft className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
          </button>
          <h1 className="font-heading text-xl font-bold text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5]">
            Join Requests
          </h1>
          {totalRequests > 0 && (
            <span className="bg-[#EF4444] text-white text-xs font-bold px-2 py-1 rounded-full">
              {totalRequests}
            </span>
          )}
        </div>

        {totalRequests === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-neutral-800 discuss:bg-[#1a1a1a] rounded-[12px] border border-neutral-200 dark:border-neutral-700 discuss:border-[#333333]">
            <p className="text-neutral-500 dark:text-neutral-400 discuss:text-[#9CA3AF]">
              No pending join requests
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(requests).map(([groupId, groupRequests]) => {
              if (groupRequests.length === 0) return null;
              const group = groups.find(g => g.groupId === groupId);
              
              return (
                <div key={groupId} className="bg-white dark:bg-neutral-800 discuss:bg-[#1a1a1a] rounded-[12px] border border-neutral-200 dark:border-neutral-700 discuss:border-[#333333] p-4">
                  <h3 className="font-bold text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5] mb-3">
                    {group?.groupName}
                  </h3>
                  <div className="space-y-2">
                    {groupRequests.map(request => {
                      const details = userDetails[request.userId];
                      return (
                        <div key={request.userId} className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-700 discuss:bg-[#262626] rounded-lg">
                          <div className="flex items-center gap-3">
                            {details?.photo_url ? (
                              <img src={details.photo_url} alt="" className="w-10 h-10 rounded-full" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-[#2563EB] discuss:bg-[#EF4444] flex items-center justify-center">
                                <span className="text-white font-bold text-sm">
                                  {details?.username?.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-1">
                                <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-50 discuss:text-[#F5F5F5]">
                                  @{details?.username || 'User'}
                                </span>
                                {details?.verified && <VerifiedBadge size="sm" />}
                              </div>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                {new Date(request.requestedAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleAccept(groupId, request.userId)}
                              className="bg-green-600 hover:bg-green-700 text-white"
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReject(groupId, request.userId)}
                              className="text-red-600 border-red-200"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
