import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { forbidden, notFound } from '../../utils/errors';
import { chat } from './chat.service';
import { assertCanSendAiMessage, getUserPlan } from '../billing/enforce';
import { PLAN_LIMITS } from '../billing/plans';

const router = Router();
router.use(requireAuth);

const sendSchema = z.object({
  conversationId: z.string().cuid().optional().nullable(),
  message: z.string().min(1).max(4000),
});

const renameSchema = z.object({
  title: z.string().min(1).max(120),
});

function summarize(text: string, max = 60) {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + '…';
}

router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const plan = await getUserPlan(req.userId!);
    if (!PLAN_LIMITS[plan].conversationHistory) {
      res.json([]);
      return;
    }
    const conversations = await prisma.conversation.findMany({
      where: { userId: req.userId! },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    });
    res.json(
      conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messageCount: c._count.messages,
        lastMessage: c.messages[0]
          ? {
              role: c.messages[0].role,
              preview: summarize(c.messages[0].content, 100),
              createdAt: c.messages[0].createdAt.toISOString(),
            }
          : null,
      })),
    );
  }),
);

router.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const plan = await getUserPlan(req.userId!);
    if (!PLAN_LIMITS[plan].conversationHistory) {
      throw forbidden('Conversation history requires Premium.');
    }
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv) throw notFound();
    res.json({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }),
);

router.patch(
  '/conversations/:id',
  validate(renameSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { title: req.body.title },
    });
    res.json({
      id: updated.id,
      title: updated.title,
      updatedAt: updated.updatedAt.toISOString(),
    });
  }),
);

router.delete(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    await prisma.conversation.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

router.post(
  '/',
  validate(sendSchema),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { conversationId, message } = req.body as z.infer<typeof sendSchema>;

    await assertCanSendAiMessage(userId);
    const plan = await getUserPlan(userId);
    const keepHistory = PLAN_LIMITS[plan].conversationHistory;

    // Non-Premium users get a fresh single-shot every time — ignore any
    // conversationId they pass in and never load prior turns as context.
    let conversation = keepHistory && conversationId
      ? await prisma.conversation.findFirst({ where: { id: conversationId, userId } })
      : null;

    if (keepHistory && conversationId && !conversation) throw notFound();

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId, title: summarize(message, 60) },
      });
    }

    // Persist the user's message (used for usage counting + history).
    await prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: message },
    });

    // Build context: full history for Premium, just the single message otherwise.
    const messagesForModel = keepHistory
      ? (
          await prisma.chatMessage.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'asc' },
            take: 40,
          })
        ).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      : [{ role: 'user' as const, content: message }];

    const reply = await chat(userId, messagesForModel);

    const saved = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: reply.content,
      },
    });

    // Touch conversation so list ordering reflects recent activity.
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    res.json({
      conversationId: conversation.id,
      title: conversation.title,
      message: {
        id: saved.id,
        role: 'assistant' as const,
        content: reply.content,
        createdAt: saved.createdAt.toISOString(),
      },
    });
  }),
);

export default router;
