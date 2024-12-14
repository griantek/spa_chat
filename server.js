require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { logInteraction } = require('./logger');
const app = express();
const port = process.env.PORT || 8000;

app.use(bodyParser.json()); // Middleware to parse JSON request bodies

// Welcome route to check server status
app.get('/', (req, res) => {
    res.send("Welcome! The Spa Chatbot server is running.");
});

// GET route for webhook verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log("Webhook verified successfully!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});


// POST route for webhook to handle incoming messages
app.post('/webhook', async (req, res) => {
    if (
        req.body.entry &&
        req.body.entry[0].changes &&
        req.body.entry[0].changes[0].value.messages &&
        req.body.entry[0].changes[0].value.messages[0]
    ) {
        const incomingMessage = req.body.entry[0].changes[0].value.messages[0];
        const senderId = incomingMessage.from; // WhatsApp ID (includes phone number)
        const phone = senderId.replace('whatsapp:', ''); // Extract phone number
        const name = req.body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || "there"; // Fetch user name

        // Handle text messages
        if (incomingMessage.type === 'text') {
            const messageText = incomingMessage.text?.body.toLowerCase();
            // Log the interaction
            await logInteraction(phone, {
                type: 'incoming',
                message: messageText,
                timestamp: new Date().toISOString(),
                name
            });
            if (messageText === 'hi') {
                await handleUserGreeting(phone, name);
            }
        }

        // Button reply handler
        else if (incomingMessage.type === 'interactive' && incomingMessage.interactive.type === 'button_reply') {
            const buttonId = incomingMessage.interactive.button_reply?.id.toLowerCase(); // Safely access button_reply ID

            // Log button responses
            await logInteraction(phone, {
                type: 'button_response',
                buttonId,
                timestamp: new Date().toISOString()
            });
            
            if (buttonId) {
                handleButtonResponse(phone, buttonId);
            } else {
                console.log("Button ID not found in the response.");
                sendTextMessage(phone, "Invalid button option. Please select one of the valid options.");
            }
        }

        // List reply handler
        else if (incomingMessage.type === 'interactive' && incomingMessage.interactive.type === 'list_reply') {
            const listId = incomingMessage.interactive.list_reply.id; // Safely access list_reply ID

            // Log list responses
            await logInteraction(phone, {
                type: 'list_response',
                listId,
                timestamp: new Date().toISOString()
            });
            if (listId) {
                handleListResponse(phone, listId);  // Now integrated to handle time or service list selections
            } else {
                console.log("List option ID not found in the response.");
                sendTextMessage(phone, "Invalid list option. Please select a valid option.");
            }
        }
    }

    res.sendStatus(200); // Acknowledge the webhook event
});

function formatTimeTo12Hour(time24) {
    const [hours, minutes] = time24.split(":");
    const hour = parseInt(hours, 10);
    const period = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12; // Convert 0 to 12 for 12-hour format
    return `${hour12}:${minutes} ${period}`;
  }

// Function to handle user greeting
async function handleUserGreeting(phone, name) {
    try {
        // Check if the phone is registered in the backend
        const response = await axios.get(`${process.env.BACKEND_URL}/check-phone/${phone}`);
        const { exists } = response.data;

        sendGreetingWithOptions(phone, name, exists); // Dynamically handle based on registration
    } catch (error) {
        console.error("Error checking phone:", error);
    }
}

// Check if the phone is registered in the backend
async function isExists(phone) {
    try {
        const response = await axios.get(`${process.env.BACKEND_URL}/check-phone/${phone}`);
        return response.data.exists; // Return true or false
    } catch (error) {
        console.error("Error checking user existence:", error);
        return false; // Default to false if an error occurs
    }
}

// Function to send greeting with options
async function sendGreetingWithOptions(phone, name, isRegistered) {
    // Send image greeting
    const imageMessage = {
        messaging_product: 'whatsapp',
        to: `whatsapp:${phone}`,
        type: 'image',
        image: {
            link: process.env.SPA_IMAGE_URL,
            caption: `Welcome to ${process.env.SPA_NAME}, ${name}! `
        }
    };
    await sendToWhatsApp(imageMessage);

    // Prepare options based on registration status
    const buttons = isRegistered
        ? [
              { type: 'reply', reply: { id: 'modify_booking', title: 'Modify Booking' } },
              { type: 'reply', reply: { id: 'cancel_booking', title: 'Cancel Booking' } },
              { type: 'reply', reply: { id: 'more_services', title: 'More Services' } }
          ]
        : [
              { type: 'reply', reply: { id: 'book_appointment', title: 'Book Appointment' } },
              { type: 'reply', reply: { id: 'more_services', title: 'More Services' } }
          ];

    // Send interactive message
    const interactiveMessage = {
        messaging_product: 'whatsapp',
        to: `whatsapp:${phone}`,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: `Hello ${name}, how can we assist you today?` },
            footer: { text: 'Choose an option below:' },
            action: { buttons }
        }
    };
    await sendToWhatsApp(interactiveMessage);
}

// Function to handle button responses
async function handleButtonResponse(phone, buttonId) {
     try {
        const response = await axios.get(`${process.env.BACKEND_URL}/generate-token?phone=${phone}`);
        const { token } = response.data;
        
        switch (buttonId) {
            case 'modify_booking':
                sendTextMessage(phone, `Modify your booking here: ${process.env.FRONTEND_MODIFY_URL}?token=` + token);
                break;
                
            case 'cancel_booking':
                sendCancelConfirmation(phone);
                break;

            case 'more_services':
                sendMoreServicesOptions(phone);
                break;

            case 'book_appointment':
                sendTextMessage(phone, `Great! You can book your appointment here: ${process.env.FRONTEND_REGISTER_URL}?token=` + token);
                scheduleFollowUp(phone);
                break;
              
            case 'book_yes': // User confirmed to book an appointment
                try {
                    const userExists = await isExists(phone); // Check if the user exists
                    if (userExists) {
                        sendTextMessage(phone, `Oops! You already booked an appointemt, You can modify your booking here: ${process.env.FRONTEND_MODIFY_URL}?token=` + token);
                    } else {
                        sendTextMessage(phone, `Great! You can book your appointment here: ${process.env.FRONTEND_REGISTER_URL}?token=` + token);
                        scheduleFollowUp(phone);
                    }
                } catch (error) {
                    console.error("Error validating user existence for modify:", error);
                    sendTextMessage(phone, "Something went wrong. Please try again later.");
                }
                break;

            case 'book_no': // User declined to book an appointment
                sendTextMessage(phone, "We really like to serve you. You can still book us by sending a Hi.");
                break;    

            case 'cancel_yes':
                cancelBooking(phone);
                break;

            case 'cancel_no':
                sendTextMessage(phone, "Thank you for your change of mind. We are happy to serve you!");
                break;

            default:
                sendTextMessage(phone, "Invalid option selected.");
        }
    } catch (error) {
        console.error("Error generating token:", error);
        sendTextMessage(phone, "An error occurred. Please try again later.");
    }
}

// Helper function to send spa location
async function sendLocation(phone) {
    const locationMessage = {
        messaging_product: 'whatsapp',
        to: `whatsapp:${phone}`,
        type: 'location',
        location: {
            latitude: process.env.SPA_LATITUDE, // Example latitude
            longitude: process.env.SPA_LONGITUDE, // Example longitude
            name: process.env.SPA_NAME,
            address: process.env.SPA_ADDRESS
        }
    };

    await sendToWhatsApp(locationMessage);
}

// Function to schedule a follow-up after "Book Appointment"
async function scheduleFollowUp(phone) {
    setTimeout(async () => {
        try {
            const response = await axios.get(`${process.env.BACKEND_URL}/check-phone/${phone}`);
            const { exists, appointment } = response.data;               
            if (exists) {
                const details = `
                    Thank you for booking with us.We look forward to serving you!\nHere are your appointment details:\n- Service: ${appointment.service}\n- Date: ${appointment.date}\n- Time: ${formatTimeTo12Hour(appointment.time)}\n📍 Location: ${process.env.SPA_NAME}, ${process.env.SPA_ADDRESS}
                `;
                sendTextMessage(phone, details);
                await sendLocation(phone);
            } else {
                const response = await axios.get(`${process.env.BACKEND_URL}/generate-token?phone=${phone}`);
                const { token } = response.data; 
                sendTextMessage(phone, `It seems you haven't booked an appointment yet. You may consider booking one using the link below: ${process.env.FRONTEND_REGISTER_URL}?token=` + token);
            }
        } catch (error) {
            console.error("Error in follow-up check:", error);
        }
    }, 10 * 60 * 1000); // 10 minutes in milliseconds
}


// Send cancel confirmation
async function sendCancelConfirmation(phone) {
    const interactiveMessage = {
        messaging_product: 'whatsapp',
        to: `whatsapp:${phone}`,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: 'Are you sure you want to cancel your booking?' },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: 'cancel_yes', title: 'Yes' } },
                    { type: 'reply', reply: { id: 'cancel_no', title: 'No' } }
                ]
            }
        }
    };
    await sendToWhatsApp(interactiveMessage);
}

// Cancel booking
async function cancelBooking(phone) {
    try {
        await axios.post(`${process.env.BACKEND_URL}/cancel-appointment`, { phone });
        sendTextMessage(phone, "Your booking has been cancelled. You can book another appointment anytime by sending a Hi.");
    } catch (error) {
        console.error("Error canceling booking:", error);
        sendTextMessage(phone, "Something went wrong. Please try again.");
    }
}

// Send "More Services" menu
async function sendMoreServicesOptions(phone) {
    const servicesMenu = {
        messaging_product: 'whatsapp',
        to: `whatsapp:${phone}`,
        type: 'interactive',
        interactive: {
            type: 'list',
            header: { type: 'text', text: 'Explore Our Services' },
            body: { text: 'Choose an option below:' },
            action: {
                button: 'Select Service',
                sections: [
                    {
                        title: 'Spa Services',
                        rows: [
                            { id: 'service_1', title: 'Facial Treatment' },
                            { id: 'service_2', title: 'Massage Therapy' },
                            { id: 'service_3', title: 'Hair Removal' },
                            { id: 'service_4', title: 'Manicure & Pedicure' },
                            { id: 'service_5', title: 'Acne Treatment' },
                            { id: 'service_6', title: 'Body Scrub' },
                            { id: 'service_7', title: 'Hot Stone Massage' },
                            { id: 'service_8', title: 'Nail Art & Design' }
                        ]
                    },
                    {
                        title: 'Contact Options',
                        rows: [
                            { id: 'contact_us', title: 'Contact Us' },
                            { id: 'spa_location', title: 'Spa Location' }
                        ]
                    }
                ]
            }
        }
    };
    await sendToWhatsApp(servicesMenu);
}



// Handle list responses (More Services)
async function handleListResponse(phone, listId) {
    switch (listId) {
        case 'service_1':
        case 'service_2':
        case 'service_3':
        case 'service_4':
        case 'service_5':
        case 'service_6':
        case 'service_7':
        case 'service_8':
            const serviceName = getServiceName(listId);
            await sendServiceConfirmation(phone, serviceName);
            break;

        case 'contact_us':
            sendTextMessage(phone, `📞 Contact us at ${process.env.SPA_CONTACT}`);
            break;

        case 'spa_location':
            sendLocation(phone);
            sendTextMessage(phone, `📍 Visit us at: ${process.env.SPA_ADDRESS}`);
            break;

        default:
            sendTextMessage(phone, "Invalid selection.");
    }
}

// Helper function to map list ID to service name
function getServiceName(listId) {
    const services = {
        service_1: 'Facial Treatment',
        service_2: 'Massage Therapy',
        service_3: 'Hair Removal',
        service_4: 'Manicure & Pedicure',
        service_5: 'Acne Treatment',
        service_6: 'Body Scrub',
        service_7: 'Hot Stone Massage',
        service_8: 'Nail Art & Design',
    };
    return services[listId] || "Unknown Service";
}

// Function to send confirmation for selected service
async function sendServiceConfirmation(phone, serviceName) {
    const interactiveMessage = {
        messaging_product: 'whatsapp',
        to: `whatsapp:${phone}`,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: `You selected ${serviceName}. Would you like to book an appointment?` },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: 'book_yes', title: 'Yes' } },
                    { type: 'reply', reply: { id: 'book_no', title: 'No' } }
                ]
            }
        }
    };
    await sendToWhatsApp(interactiveMessage);
}


// Helper function to send text message
async function sendTextMessage(phone, text) {
    const messageData = {
        messaging_product: 'whatsapp',
        to: `whatsapp:${phone}`,
        type: 'text',
        text: { body: text }
    };

    // Log the interaction
    await logInteraction(phone, {
        type: 'outgoing',
        message: text,
        timestamp: new Date().toISOString()
    });

    await sendToWhatsApp(messageData);
}

// Helper function to send messages via WhatsApp API
async function sendToWhatsApp(messageData) {
    try {
        await axios.post(process.env.WHATSAPP_API_URL, messageData, {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
        });
    } catch (error) {
        console.error("Error sending message:", error.response?.data || error.message);
    }
}

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
