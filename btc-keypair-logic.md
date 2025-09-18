In order to have compatibilty between our web wallet and our extension, it would be great if by default a BTC keypair is created based on the vfx private key.

In the webwallet we do it this way (this is dart code btw)


var email = "${privateKey.substring(0, 8)}@${privateKey.substring(privateKey.length - 8)}.com"
var password = "${privateKey.substring(0, 12)}${privateKey.substring(privateKey.length - 12)}"

Then we run it through a JS function like this:


public keypairFromEmailPassword(email: string, password: string, index = 0) {

        email = email.toLowerCase();
        let seed = `${email}|${password}|`;
        seed = `${seed}${seed.length}|!@${((password.length * 7) + email.length) * 7}`;

        const regChars = /[a-z]+/g;
        const regUpperChars = /[A-Z]+/g;
        const regNumbers = /[0-9]+/g;

        const charsMatches = password.match(regChars);
        const chars = charsMatches ? charsMatches.length : 1;

        const upperCharsMatches = password.match(regUpperChars);
        const upperChars = upperCharsMatches ? upperCharsMatches.length : 1;

        const numbersMatches = password.match(regNumbers);
        const numbers = numbersMatches ? numbersMatches.length : 1;

        seed = `${seed}${(chars + upperChars + numbers) * password.length}3571`;
        seed = `${seed}${seed}`

        for (let i = 0; i <= 50; i++) {
            seed = hashSeed(seed)
        }


        const privateKey = seedToPrivateKey(seed, index, this.network);
        if (!privateKey) throw new Error('Invalid private key');

        const keyPair = ECPair.fromPrivateKey(privateKey, { network: this.network });
        return this.buildOutput(keyPair);

    }

    Is this possible? Is there any security issues doing it this way?