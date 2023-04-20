import { join } from "path";
import { promisify } from "util";
import { writeFile } from "fs";
import * as Sentry from "@sentry/node";
import ListSettingsServiceOne from "../SettingServices/ListSettingsServiceOne";
import Settings from "../../models/Setting";

import {
  Contact as WbotContact,
  Message as WbotMessage,
  MessageAck,
  Client,
  MessageMedia
} from "whatsapp-web.js";

import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";

import { getIO } from "../../libs/socket";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { debounce } from "../../helpers/Debounce";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import CreateContactService from "../ContactServices/CreateContactService";
// import GetContactService from "../ContactServices/GetContactService";
import ShowBotsService from "../WhatsappService/ShowBotsService";
import UpdateCommandService from "../ContactServices/UpdateCommandService";
import GetCommandService from "../ContactServices/GetCommandService";
import ShowMenu from "../../helpers/ShowMenu";
import { ConstructMenu } from "../BotServices/MenuBots";

import formatBody from "../../helpers/Mustache";

interface Session extends Client {
  id?: number;
}

const writeFileAsync = promisify(writeFile);

const verifyContact = async (msgContact: WbotContact): Promise<Contact> => {
  try {
    const profilePicUrl = await msgContact.getProfilePicUrl();
    const contactData = {
      name: msgContact.name || msgContact.pushname || msgContact.id.user,
      number: msgContact.id.user,
      profilePicUrl,
      isGroup: msgContact.isGroup
    };
    const contact = CreateOrUpdateContactService(contactData);
    return contact;
  } catch (err) {
    const profilePicUrl = "/default-profile.png"; // Foto de perfil padrão
    const contactData = {
      name: msgContact.name || msgContact.pushname || msgContact.id.user,
      number: msgContact.id.user,
      profilePicUrl,
      isGroup: msgContact.isGroup
    };
    const contact = CreateOrUpdateContactService(contactData);
    return contact;
  }
};

const verifyCommand = async (msgContact: WbotContact, command: string): Promise<Contact> => {
  const contactData = {
    number: msgContact.id.user,
    isGroup: msgContact.isGroup,
    commandBot: command
  };

  const contact = UpdateCommandService(contactData);

  return contact;
};

const verifyQuotedMessage = async (
  msg: WbotMessage
): Promise<Message | null> => {
  if (!msg.hasQuotedMsg) return null;

  const wbotQuotedMsg = await msg.getQuotedMessage();

  const quotedMsg = await Message.findOne({
    where: { id: wbotQuotedMsg.id.id }
  });

  if (!quotedMsg) return null;

  return quotedMsg;
};

const verifyMediaMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
): Promise<Message> => {
  const quotedMsg = await verifyQuotedMessage(msg);

  const media = await msg.downloadMedia();

  if (!media) {
    throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
  }

  /* Check if media not have a filename */

  if (!media.filename) {
    const ext = media.mimetype.split("/")[1].split(";")[0];
    media.filename = `${new Date().getTime()}.${ext}`;
  }

  try {
    const ext = media.mimetype.split("/")[1].split(";")[0];
    media.filename = `${new Date().getTime()} - ${media.filename}`;
    await writeFileAsync(
      join(__dirname, "..", "..", "..", "public", media.filename),
      media.data,
      "base64"
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }

  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: msg.body,
    fromMe: msg.fromMe,
    read: msg.fromMe,
    mediaUrl: media.filename,
    mediaType: media.mimetype.split("/")[0],
    quotedMsgId: quotedMsg?.id
  };

  await ticket.update({ lastMessage: msg.body });
  const newMessage = await CreateMessageService({ messageData });

  return newMessage;
};

const verifyMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {
  if (msg.type === "location") msg = prepareLocation(msg);

  const quotedMsg = await verifyQuotedMessage(msg);
  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: msg.body,
    fromMe: msg.fromMe,
    mediaType: msg.type,
    read: msg.fromMe,
    quotedMsgId: quotedMsg?.id
  };

  await ticket.update({ lastMessage: msg.type === "location" ? msg.location.description ? "Localization - " + msg.location.description.split('\\n')[0] : "Localization" : msg.body });

  await CreateMessageService({ messageData });
};

const prepareLocation = (msg: WbotMessage): WbotMessage => {
  let gmapsUrl = "https://maps.google.com/maps?q=" + msg.location.latitude + "%2C" + msg.location.longitude + "&z=17&hl=pt-BR";

  msg.body = "data:image/png;base64," + msg.body + "|" + gmapsUrl;

  msg.body += "|" + (msg.location.description ? msg.location.description : (msg.location.latitude + ", " + msg.location.longitude))

  return msg;
};

const verifyQueue = async (
  wbot: Session,
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {
  const { queues, greetingMessage } = await ShowWhatsAppService(wbot.id!);

  if (queues.length === 1) {
    await UpdateTicketService({
      ticketData: { queueId: queues[0].id },
      ticketId: ticket.id
    });

    return;
  }

  const selectedOption = msg.body;

  const choosenQueue = queues[+selectedOption - 1];

  if (choosenQueue) {
    await UpdateTicketService({
      ticketData: { queueId: choosenQueue.id },
      ticketId: ticket.id
    });

    const body = formatBody(`\u200e${choosenQueue.greetingMessage}`, contact);

    const sentMessage = await wbot.sendMessage(`${contact.number}@c.us`, body);

    await verifyMessage(sentMessage, ticket, contact);
  } else {
    let options = "";

    queues.forEach((queue, index) => {
      options += `*${index + 1}* - ${queue.name}\n`;
    });

    const body = formatBody(`\u200e${greetingMessage}\n${options}`, contact);

    const debouncedSentMessage = debounce(
      async () => {
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@c.us`,
          body
        );
        verifyMessage(sentMessage, ticket, contact);
      },
      3000,
      ticket.id
    );

    debouncedSentMessage();
  }
};

function detectMimeType(encoded) {
  var result = null;

  if (typeof encoded !== 'string') {
    return result;
  }

  var mime = encoded.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/);

  if (mime && mime.length) {
    result = mime[1];
  }

  return result;
}

const verifyBots = async (
  wbot: Session,
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {
  const bots = await ShowBotsService();
  const { greetingMessage } = await ShowWhatsAppService(wbot.id!);

  if (bots.length === 0) {
    return;
  }

  const commandContact = await msg.getContact();
  const lastCommand = await GetCommandService(contact.number); // essa linha não atualiza o comando, apenas busca o comando salvo no contato
  const selectedOption = lastCommand?.commandBot ? lastCommand?.commandBot + '.' + msg.body : msg.body;

  const choosenBot = bots.find(bot => bot.commandBot === selectedOption);

  if (choosenBot) {
    let body = "";
    switch (choosenBot.commandType) {
      case 1: // INFORMATIVO
        body = `\u200e${choosenBot.showMessage}`;
        await verifyCommand(commandContact, choosenBot.commandBot);
        // await UpdateTicketService({
        //   ticketData: { queueId: choosenBot.queueId },
        //   ticketId: ticket.id
        // });
        await ticket.update({ queueId: choosenBot.queueId });
        break;
      // case 2: // MENU
      //   body = `\u200e${ShowMenu(selectedOption, bots)}`;
      //   await verifyCommand(commandContact, choosenBot.commandBot);
      //   break;
      // case 3: // SETOR
      //   body = `\u200e${choosenBot.showMessage}`;
      //   await verifyCommand(commandContact, choosenBot.commandBot);
      //   await UpdateTicketService({
      //     ticketData: { queueId: choosenBot.queueId },
      //     ticketId: ticket.id
      //   });
      //   break;
      // case 4: // ATENDENTE
      //   body = `\u200e${choosenBot.showMessage}`;
      //   await verifyCommand(commandContact, choosenBot.commandBot);
      //   await UpdateTicketService({
      //     ticketData: { userId: choosenBot.userId },
      //     ticketId: ticket.id
      //   });
      //   break;
    }

    // const body = formatBody(`\u200e${choosenBot.greetingMessage}`, contact);

    const sentMessage = await wbot.sendMessage(`${contact.number}@c.us`, body);

    await verifyMessage(sentMessage, ticket, contact);
  } else {
    if (lastCommand?.commandBot) {
      // já está em atendimento, NÃO mostrar o menu novamente!

      return;
    }

    let options = await ConstructMenu();
    // const body = `\u200e${greetingMessage}\n\n${options}`;
    //const body = formatBody(`\u200e${greetingMessage}\n${options}`, contact);

    //#ENVIA A MENSAGEM PADRÃO PRIMEIRO
    const body = formatBody(`\u200e${greetingMessage}\n`, contact);

    const debouncedSentMessage = debounce(
      async () => {
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@c.us`,
          body
        );
        verifyMessage(sentMessage, ticket, contact);
      },
      1000,
      ticket.id
    );

    debouncedSentMessage();

    //#ENVIA AS MENSAGENS DEFINIDAS
    (async function () {

      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

      async function forEach(arr, cb) {
        for (const item of arr) {
          await cb(item);
        }
      }

      await forEach(options, async function (item) {
        await wait(item['tempo']);

        if (!item['mensagem'].includes('data:')) {
          const bodyForeach = `\u200e${item['mensagem']}\n`;
          const sentMessage = await wbot.sendMessage(
            `${contact.number}@c.us`,
            bodyForeach
          );
          verifyMessage(sentMessage, ticket, contact);

          //console.log("Não é base64 => " + item);
        } else {
          let mensagemArquivo = item['mensagem'];
          var strImage = mensagemArquivo.split(',')[1];
          var typeFile = detectMimeType(mensagemArquivo);



          const arquivoEnvio = new MessageMedia(typeFile, strImage);
          console.log("arquivoEnvio => " + arquivoEnvio);


          const envioMensagem = await wbot.sendMessage( `${contact.number}@c.us`, arquivoEnvio, { caption: "Arquivo enviado" });
          verifyMessage(envioMensagem, ticket, contact);

        }
      });

      console.log("Finalizado");


    })()



    console.log(options);

  }
};

const isValidMsg = (msg: WbotMessage): boolean => {
  if (msg.from === "status@broadcast") return false;

  if (
    msg.type === "chat" ||
    msg.type === "audio" ||
    msg.type === "call_log" ||
    msg.type === "ptt" ||
    msg.type === "video" ||
    msg.type === "image" ||
    msg.type === "document" ||
    msg.type === "vcard" ||
    // msg.type === "multi_vcard" ||
    msg.type === "sticker" ||
    msg.type === "e2e_notification" || // Ignore Empty Messages Generated When Someone Changes His Account from Personal to Business or vice-versa
    msg.type === "notification_template" || // Ignore Empty Messages Generated When Someone Changes His Account from Personal to Business or vice-versa
    // msg.author != null || // Ignore Group Messages
    msg.type === "location"
  )
    return true;
  return false;
};

const handleMessage = async (
  msg: WbotMessage,
  wbot: Session
): Promise<void> => {
  if (!isValidMsg(msg)) {
    return;
  }

  // Ignorar Mensagens de Grupo
  const Settingdb = await Settings.findOne({
    where: { key: 'CheckMsgIsGroup' }
  });
  if (Settingdb?.value == 'enabled') {
    if (
      msg.from === "status@broadcast" ||
      msg.type === "e2e_notification" ||
      msg.type === "notification_template" ||
      msg.author != null
    ) {
      return;
    }
  }
  // IGNORAR MENSAGENS DE GRUPO

  try {
    let msgContact: WbotContact;
    let groupContact: Contact | undefined;

    if (msg.fromMe) {
      // messages sent automatically by wbot have a special character in front of it
      // if so, this message was already been stored in database;
      if (/\u200e/.test(msg.body[0])) return;

      // media messages sent from me from cell phone, first comes with "hasMedia = false" and type = "image/ptt/etc"
      // in this case, return and let this message be handled by "media_uploaded" event, when it will have "hasMedia = true"

      if (
        !msg.hasMedia &&
        msg.type !== "location" &&
        msg.type !== "chat" &&
        msg.type !== "vcard"
        // && msg.type !== "multi_vcard"
      )
        return;

      msgContact = await wbot.getContactById(msg.to);
    } else {
      // Verifica se Cliente fez ligação/vídeo pelo wpp
      const listSettingsService = await ListSettingsServiceOne({ key: "call" });
      var callSetting = listSettingsService?.value;

      msgContact = await msg.getContact();
    }

    const chat = await msg.getChat();

    if (chat.isGroup) {
      let msgGroupContact;

      if (msg.fromMe) {
        msgGroupContact = await wbot.getContactById(msg.to);
      } else {
        msgGroupContact = await wbot.getContactById(msg.from);
      }

      groupContact = await verifyContact(msgGroupContact);
    }
    const whatsapp = await ShowWhatsAppService(wbot.id!);

    const unreadMessages = msg.fromMe ? 0 : chat.unreadCount;

    const contact = await verifyContact(msgContact);

    if (
      unreadMessages === 0 &&
      whatsapp.farewellMessage &&
      formatBody(whatsapp.farewellMessage, contact) === msg.body
    )
      return;

    const ticket = await FindOrCreateTicketService({
      contact,
      whatsappId: wbot.id!,
      unreadMessages,
      groupContact,
      channel: "whatsapp"
    });

    if (msg.hasMedia) {
      await verifyMediaMessage(msg, ticket, contact);
    } else {
      await verifyMessage(msg, ticket, contact);
    }

    if (
      !ticket.queue &&
      !chat.isGroup &&
      !msg.fromMe &&
      !ticket.userId &&
      whatsapp.queues.length >= 1
    ) {
      await verifyBots(wbot, msg, ticket, contact); // await verifyQueue(wbot, msg, ticket, contact);
      await verifyQueue(wbot, msg, ticket, contact);
    }

    if (msg.type === "vcard") {
      try {
        const array = msg.body.split("\n");
        const obj = [];
        let contact = "";
        for (let index = 0; index < array.length; index++) {
          const v = array[index];
          const values = v.split(":");
          for (let ind = 0; ind < values.length; ind++) {
            if (values[ind].indexOf("+") !== -1) {
              obj.push({ number: values[ind] });
            }
            if (values[ind].indexOf("FN") !== -1) {
              contact = values[ind + 1];
            }
          }
        }
        for await (const ob of obj) {
          const cont = await CreateContactService({
            name: contact,
            number: ob.number.replace(/\D/g, "")
          });
        }
      } catch (error) {
        console.log(error);
      }
    }

    /* if (msg.type === "multi_vcard") {
      try {
        const array = msg.vCards.toString().split("\n");
        let name = "";
        let number = "";
        const obj = [];
        const conts = [];
        for (let index = 0; index < array.length; index++) {
          const v = array[index];
          const values = v.split(":");
          for (let ind = 0; ind < values.length; ind++) {
            if (values[ind].indexOf("+") !== -1) {
              number = values[ind];
            }
            if (values[ind].indexOf("FN") !== -1) {
              name = values[ind + 1];
            }
            if (name !== "" && number !== "") {
              obj.push({
                name,
                number
              });
              name = "";
              number = "";
            }
          }
        }
        // eslint-disable-next-line no-restricted-syntax
        for await (const ob of obj) {
          try {
            const cont = await CreateContactService({
              name: ob.name,
              number: ob.number.replace(/\D/g, "")
            });
            conts.push({
              id: cont.id,
              name: cont.name,
              number: cont.number
            });
          } catch (error) {
            if (error.message === "ERR_DUPLICATED_CONTACT") {
              const cont = await GetContactService({
                name: ob.name,
                number: ob.number.replace(/\D/g, ""),
                email: ""
              });
              conts.push({
                id: cont.id,
                name: cont.name,
                number: cont.number
              });
            }
          }
        }
        msg.body = JSON.stringify(conts);
      } catch (error) {
        console.log(error);
      }
    } */

    if (msg.type === "call_log" && callSetting === "disabled") {
      const sentMessage = await wbot.sendMessage(`${contact.number}@c.us`, "*Mensaje Automatico:*\nLas llamadas de voz y video están deshabilitadas para este WhatsApp, envíe un mensaje de texto. Gracias");
      await verifyMessage(sentMessage, ticket, contact);
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling whatsapp message: Err: ${err}`);
  }
};

const handleMsgAck = async (msg: WbotMessage, ack: MessageAck) => {
  await new Promise(r => setTimeout(r, 500));

  const io = getIO();

  try {
    const messageToUpdate = await Message.findByPk(msg.id.id, {
      include: [
        "contact",
        {
          model: Message,
          as: "quotedMsg",
          include: ["contact"]
        }
      ]
    });
    if (!messageToUpdate) {
      return;
    }
    await messageToUpdate.update({ ack });

    io.to(messageToUpdate.ticketId.toString()).emit("appMessage", {
      action: "update",
      message: messageToUpdate
    });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message ack. Err: ${err}`);
  }
};

const wbotMessageListener = (wbot: Session): void => {
  wbot.on("message_create", async msg => {
    handleMessage(msg, wbot);
  });

  wbot.on("media_uploaded", async msg => {
    handleMessage(msg, wbot);
  });

  wbot.on("message_ack", async (msg, ack) => {
    handleMsgAck(msg, ack);
  });
};

export { wbotMessageListener, handleMessage };
