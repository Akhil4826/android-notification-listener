import os
import math
from PIL import Image, ImageDraw, ImageFont

def create_demo_gif():
    width = 960
    height = 530
    fps = 4
    total_frames = 48

    # Windows Standard Fonts
    font_title = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", 20)
    font_bold = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", 15)
    font_regular = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 14)
    font_small = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 12)
    font_code = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 12)

    # Theme Colors
    bg_color = (13, 17, 26)
    card_bg = (21, 28, 42)
    card_header = (27, 36, 54)
    card_border = (42, 54, 76)
    text_primary = (240, 243, 246)
    text_secondary = (140, 153, 170)
    alexa_cyan = (0, 202, 255)
    whatsapp_green = (37, 211, 102)
    android_green = (61, 220, 132)
    accent_orange = (255, 153, 0)
    bubble_user = (28, 38, 58)
    bubble_alexa = (16, 52, 78)

    frames = []

    for f in range(total_frames):
        img = Image.new("RGB", (width, height), bg_color)
        draw = ImageDraw.Draw(img)

        # Header Bar
        draw.rectangle([(0, 0), (width, 54)], fill=(17, 23, 35))
        draw.line([(0, 54), (width, 54)], fill=card_border, width=1)

        # Logo / Title
        draw.ellipse([(20, 15), (42, 37)], fill=alexa_cyan)
        draw.ellipse([(26, 21), (36, 31)], fill=(17, 23, 35))
        draw.text((52, 14), "Mobile Reader", font=font_title, fill=text_primary)
        draw.text((196, 19), "Voice AI & Serverless Event Pipeline", font=font_small, fill=text_secondary)

        # Tech Badges in Header
        pills = [("Android Kotlin", android_green), ("Cloud Edge (AWS/CF)", accent_orange), ("Echo Dot Voice", alexa_cyan)]
        rx = width - 20
        for p_text, p_col in reversed(pills):
            p_w = len(p_text) * 7 + 18
            rx -= p_w
            draw.rounded_rectangle([(rx, 15), (rx + p_w - 6, 38)], radius=5, fill=(24, 32, 48), outline=p_col, width=1)
            draw.text((rx + 8, 19), p_text, font=font_small, fill=p_col)
            rx -= 6

        # Card 1: Android Smartphone Daemon (Left side)
        c1_left, c1_top, c1_right, c1_bottom = 20, 68, 460, 460
        draw.rounded_rectangle([(c1_left, c1_top), (c1_right, c1_bottom)], radius=8, fill=card_bg, outline=card_border, width=1)
        
        # Phone Header
        draw.rectangle([(c1_left, c1_top), (c1_right, c1_top + 36)], fill=card_header)
        draw.ellipse([(c1_left + 16, c1_top + 12), (c1_left + 26, c1_top + 22)], fill=android_green)
        draw.text((c1_left + 34, c1_top + 8), "Android Smartphone Daemon", font=font_bold, fill=text_primary)
        draw.text((c1_right - 85, c1_top + 10), "Silent Mode", font=font_small, fill=android_green)

        # Phone notification status
        draw.text((c1_left + 18, c1_top + 46), "Service: NotificationListenerService [Foreground]", font=font_small, fill=text_secondary)

        # Scene 1: WhatsApp Notification arrives (Frames 0+)
        notif_y = c1_top + 68
        draw.rounded_rectangle([(c1_left + 14, notif_y), (c1_right - 14, notif_y + 80)], radius=6, fill=(28, 38, 56), outline=whatsapp_green, width=1)
        draw.ellipse([(c1_left + 26, notif_y + 14), (c1_left + 46, notif_y + 34)], fill=whatsapp_green)
        draw.text((c1_left + 30, notif_y + 14), "W", font=font_bold, fill=(255, 255, 255))
        draw.text((c1_left + 54, notif_y + 12), "WhatsApp  •  Just now", font=font_small, fill=text_secondary)
        draw.text((c1_left + 54, notif_y + 30), "Akhil Jio", font=font_bold, fill=text_primary)
        draw.text((c1_left + 54, notif_y + 50), "so yep. Are we still meeting at 6?", font=font_regular, fill=(220, 226, 235))

        # Scene 1.5: Sync to Cloud Edge (Frames 4+)
        sync_y = c1_top + 160
        if f >= 4:
            draw.rounded_rectangle([(c1_left + 14, sync_y), (c1_right - 14, sync_y + 74)], radius=6, fill=(16, 22, 34), outline=(50, 70, 100), width=1)
            draw.text((c1_left + 22, sync_y + 8), "Cloud Edge Synchronization", font=font_bold, fill=accent_orange)
            draw.text((c1_left + 22, sync_y + 28), ">> POST /v1/notifications (HTTPS + Bearer)", font=font_code, fill=(160, 200, 255))
            draw.text((c1_left + 22, sync_y + 48), "[Status: 200 OK | Edge Latency: 28ms | Synced]", font=font_code, fill=android_green)

        # Phone Battery & Heartbeat Info
        info_y = c1_top + 252
        draw.rounded_rectangle([(c1_left + 14, info_y), (c1_right - 14, c1_bottom - 14)], radius=6, fill=(18, 24, 36), outline=(32, 42, 60), width=1)
        draw.text((c1_left + 24, info_y + 10), "Device Telemetry & Health:", font=font_bold, fill=text_primary)
        draw.text((c1_left + 24, info_y + 32), "- Heartbeat Daemon: Active (Sync #142)", font=font_small, fill=text_secondary)
        draw.text((c1_left + 24, info_y + 52), "- Battery Level: 88% (Discharging)", font=font_small, fill=text_secondary)
        draw.text((c1_left + 24, info_y + 72), "- Phone Speaker: Completely Silent (No alerts)", font=font_small, fill=android_green)
        draw.text((c1_left + 24, info_y + 92), "- Local Storage: Room DB (Zero pending backlog)", font=font_small, fill=text_secondary)

        # Card 2: Amazon Echo Speaker & Voice Interaction (Right side)
        c2_left, c2_top, c2_right, c2_bottom = 480, 68, width - 20, 460
        draw.rounded_rectangle([(c2_left, c2_top), (c2_right, c2_bottom)], radius=8, fill=card_bg, outline=card_border, width=1)

        # Echo Header
        draw.rectangle([(c2_left, c2_top), (c2_right, c2_top + 36)], fill=card_header)
        ring_pulse = int(128 + 127 * math.sin(f * 0.4))
        draw.ellipse([(c2_left + 16, c2_top + 12), (c2_left + 26, c2_top + 22)], fill=(0, ring_pulse, 255))
        draw.text((c2_left + 34, c2_top + 8), "Amazon Echo Dot (Custom Skill)", font=font_bold, fill=text_primary)
        draw.text((c2_right - 80, c2_top + 10), "Alexa NLU", font=font_small, fill=alexa_cyan)

        # Interaction Flow Inside Card 2
        # Turn 1: User asks Alexa (Frames 8+)
        t1_y = c2_top + 46
        if f >= 8:
            draw.rounded_rectangle([(c2_left + 14, t1_y), (c2_right - 14, t1_y + 38)], radius=6, fill=bubble_user)
            draw.text((c2_left + 24, t1_y + 9), 'User: "Alexa, did Akhil Jio message me?"', font=font_bold, fill=(255, 255, 255))

        # Turn 2: Alexa answers from Cloud Edge (Frames 14+)
        t2_y = t1_y + 46
        if f >= 14:
            draw.rounded_rectangle([(c2_left + 14, t2_y), (c2_right - 14, t2_y + 58)], radius=6, fill=bubble_alexa, outline=alexa_cyan, width=1)
            draw.text((c2_left + 24, t2_y + 7), "Alexa Echo Dot:", font=font_bold, fill=alexa_cyan)
            draw.text((c2_left + 24, t2_y + 24), '"Yes! Message from Akhil Jio on WhatsApp: so yep.', font=font_regular, fill=text_primary)
            draw.text((c2_left + 24, t2_y + 40), ' Would you like to reply?"', font=font_regular, fill=text_primary)

        # Turn 3: User replies (Frames 22+)
        t3_y = t2_y + 66
        if f >= 22:
            draw.rounded_rectangle([(c2_left + 14, t3_y), (c2_right - 14, t3_y + 38)], radius=6, fill=bubble_user)
            draw.text((c2_left + 24, t3_y + 9), 'User: "Reply saying I will be there in 10 mins"', font=font_bold, fill=(255, 255, 255))

        # Turn 4: Alexa asks for 4-digit PIN 2FA (Frames 28+)
        t4_y = t3_y + 46
        if f >= 28:
            draw.rounded_rectangle([(c2_left + 14, t4_y), (c2_right - 14, t4_y + 52)], radius=6, fill=bubble_alexa, outline=accent_orange, width=1)
            draw.text((c2_left + 24, t4_y + 7), "Alexa (Voice 2FA Confirmation):", font=font_bold, fill=accent_orange)
            draw.text((c2_left + 24, t4_y + 26), '"To confirm sending, please say your secret key."', font=font_regular, fill=text_primary)

        # Turn 5: User speaks PIN & Verified (Frames 36+)
        t5_y = t4_y + 60
        if f >= 36:
            draw.rounded_rectangle([(c2_left + 14, t5_y), (c2_right - 14, t5_y + 42)], radius=6, fill=(18, 42, 28), outline=android_green, width=1)
            draw.text((c2_left + 24, t5_y + 5), 'User: "Four eight two six"', font=font_bold, fill=text_primary)
            draw.text((c2_left + 24, t5_y + 22), 'Alexa: [OK] "PIN Verified. Message sent to Akhil Jio!"', font=font_bold, fill=android_green)

        # Bottom Summary Banner (Frames 40+)
        b_top = 472
        draw.rectangle([(0, b_top), (width, height)], fill=(15, 20, 30))
        draw.line([(0, b_top), (width, b_top)], fill=card_border, width=1)
        if f >= 40:
            draw.text((24, b_top + 16), "[VERIFIED] Silent Interception -> Cloud Edge Sync -> Voice NLU -> Voice 2FA Dispatch", font=font_bold, fill=android_green)
            # Latency Badge
            draw.rounded_rectangle([(width - 210, b_top + 10), (width - 20, b_top + 38)], radius=5, fill=(22, 32, 48), outline=alexa_cyan, width=1)
            draw.text((width - 198, b_top + 16), "E2E Latency: < 45ms", font=font_code, fill=alexa_cyan)

        frames.append(img)

    # Save animated GIF
    output_path = "images/demo.gif"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=250, # 250ms per frame = 4 fps
        loop=0,
        optimize=True
    )
    print(f"Generated animated demo GIF at: {output_path} ({len(frames)} frames)")

if __name__ == "__main__":
    create_demo_gif()
